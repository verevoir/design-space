/**
 * Tests for the (object, ref) resolver.
 *
 * Two layers:
 *   1. Integration — exercised against a real temporary git repository so git-show, the object
 *      layout and the no-checkout guarantee are confirmed against an actual process.
 *   2. Subprocess failure classification — fake git shims that exit with a normal code or a
 *      signal confirm that the resolver distinguishes the two failure kinds correctly:
 *        - a non-zero normal exit  → ObjectNotFoundError (git answered "not there")
 *        - a signal kill           → ObjectLookupError   (question unanswered; may retry)
 *
 * The `timeout: 10_000` option in the resolver's execFileAsync call sends SIGTERM when a
 * subprocess runs too long; the rejection it produces sets `signal: 'SIGTERM'` on the error
 * object, which is exactly what ObjectLookupError tests for. The signal-kill test below
 * exercises that path directly, without waiting 10 s, by using a shim that signals itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, ObjectNotFoundError, ObjectLookupError } from './resolver.js';

// ---------------------------------------------------------------------------
// Real git repository fixture
// ---------------------------------------------------------------------------

let repoDir: string;
let commitSha: string;
let commitShaToo: string; // second commit at a different ref

beforeAll(() => {
  // Spin up a minimal git repository in a temp directory.
  repoDir = mkdtempSync(join(tmpdir(), 'ds-resolver-test-'));

  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.local"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });

  // Create the layout the resolver expects.
  mkdirSync(join(repoDir, 'journeys'));
  writeFileSync(join(repoDir, 'journeys', 'test-journey.json'), JSON.stringify({ id: 'test-journey', v: 1 }));

  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "first"', { cwd: repoDir, stdio: 'pipe' });
  commitSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' })
    .toString()
    .trim();

  // Second commit with updated content — proves two refs can be read.
  writeFileSync(join(repoDir, 'journeys', 'test-journey.json'), JSON.stringify({ id: 'test-journey', v: 2 }));
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "second"', { cwd: repoDir, stdio: 'pipe' });
  commitShaToo = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' })
    .toString()
    .trim();
});

afterAll(() => {
  if (repoDir) rmSync(repoDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Happy path — real git repo
// ---------------------------------------------------------------------------

describe('resolve() against a real git repository', () => {
  it('reads the content of an object at a given ref', async () => {
    const raw = await resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha);
    const parsed = JSON.parse(raw) as { id: string; v: number };
    expect(parsed.id).toBe('test-journey');
    expect(parsed.v).toBe(1);
  });

  it('reading at a later ref returns the updated content', async () => {
    const raw = await resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitShaToo);
    const parsed = JSON.parse(raw) as { id: string; v: number };
    expect(parsed.v).toBe(2);
  });

  it('two different refs return different content, proving no working-tree mutation', async () => {
    const [r1, r2] = await Promise.all([
      resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha),
      resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitShaToo),
    ]);
    expect(r1).not.toEqual(r2);
  });

  it('throws ObjectNotFoundError for an id that does not exist at the ref', async () => {
    await expect(
      resolve(repoDir, { kind: 'journey', id: 'nonexistent' }, commitSha),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('ObjectNotFoundError names the object kind, id and ref so the caller can diagnose', async () => {
    const err = await resolve(repoDir, { kind: 'journey', id: 'nonexistent' }, commitSha)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectNotFoundError);
    const notFound = err as ObjectNotFoundError;
    expect(notFound.message).toContain('journey');
    expect(notFound.message).toContain('nonexistent');
    expect(notFound.message).toContain(commitSha);
    expect(notFound.object.kind).toBe('journey');
    expect(notFound.object.id).toBe('nonexistent');
    expect(notFound.ref).toBe(commitSha);
  });

  it('throws ObjectNotFoundError for a ref that does not exist', async () => {
    await expect(
      resolve(repoDir, { kind: 'journey', id: 'test-journey' }, 'nonexistent-ref'),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Subprocess failure classification
//
// The resolver distinguishes two failure kinds:
//   ObjectNotFoundError — git exited normally (non-zero code, no signal). The
//     object is absent; retrying will not help. This is a terminal condition.
//   ObjectLookupError   — the subprocess was killed by a signal (including the
//     SIGTERM sent when execFile's timeout fires). The question was not
//     answered; the caller may retry.
//
// Both cases are exercised by shims rather than by real slow or absent git
// processes, so the tests complete quickly. The shim for signal kills uses
// `kill -TERM $$` to exit via SIGTERM, which produces `signal: 'SIGTERM'` on
// the Node error — the same value the execFile timeout sets.
// ---------------------------------------------------------------------------

describe('resolve() subprocess failure classification', () => {
  it('a non-zero normal exit (git answered "not there") is wrapped as ObjectNotFoundError', async () => {
    // A path that is not a git repository causes `git show` to exit with a
    // normal non-zero code and no signal — the same class of failure as a
    // genuine missing object or bad ref.
    const notARepo = mkdtempSync(join(tmpdir(), 'ds-not-a-repo-'));
    try {
      await expect(
        resolve(notARepo, { kind: 'journey', id: 'anything' }, 'HEAD'),
      ).rejects.toBeInstanceOf(ObjectNotFoundError);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it('a shim that exits with a non-zero code (no signal) is wrapped as ObjectNotFoundError', async () => {
    // Shell shim: exits with code 1 — a normal non-zero exit, not a signal kill.
    const shimDir = mkdtempSync(join(tmpdir(), 'ds-git-shim-'));
    const shimPath = join(shimDir, 'git');
    writeFileSync(shimPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const origPath = process.env['PATH'] ?? '';
    process.env['PATH'] = `${shimDir}:${origPath}`;
    try {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha),
      ).rejects.toBeInstanceOf(ObjectNotFoundError);
    } finally {
      process.env['PATH'] = origPath;
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('a subprocess killed by SIGTERM (signal kill, same mechanism as the execFile timeout) is wrapped as ObjectLookupError', async () => {
    // Shell shim: kills itself with SIGTERM, producing `signal: 'SIGTERM'` on
    // the Node error — the exact value the execFile timeout sets when it kills
    // a hung process. This exercises the ObjectLookupError branch without
    // waiting for the 10 s timeout to fire.
    const shimDir = mkdtempSync(join(tmpdir(), 'ds-git-sigterm-'));
    const shimPath = join(shimDir, 'git');
    writeFileSync(shimPath, '#!/bin/sh\nkill -TERM $$\n', { mode: 0o755 });
    const origPath = process.env['PATH'] ?? '';
    process.env['PATH'] = `${shimDir}:${origPath}`;
    try {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha),
      ).rejects.toBeInstanceOf(ObjectLookupError);
    } finally {
      process.env['PATH'] = origPath;
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('ObjectLookupError names the object and ref so the caller can log and retry', async () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'ds-git-sigterm2-'));
    const shimPath = join(shimDir, 'git');
    writeFileSync(shimPath, '#!/bin/sh\nkill -TERM $$\n', { mode: 0o755 });
    const origPath = process.env['PATH'] ?? '';
    process.env['PATH'] = `${shimDir}:${origPath}`;
    try {
      const err = await resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ObjectLookupError);
      const lookupErr = err as ObjectLookupError;
      expect(lookupErr.object.kind).toBe('journey');
      expect(lookupErr.object.id).toBe('test-journey');
      expect(lookupErr.ref).toBe(commitSha);
      expect(lookupErr.message).toContain('journey');
      expect(lookupErr.message).toContain('test-journey');
    } finally {
      process.env['PATH'] = origPath;
      rmSync(shimDir, { recursive: true, force: true });
    }
  });
});
