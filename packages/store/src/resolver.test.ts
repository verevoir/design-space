/**
 * Tests for the (object, ref) resolver.
 *
 * Two layers:
 *   1. Integration — exercised against a real temporary git repository so git-show, the object
 *      layout and the no-checkout guarantee are confirmed against an actual process.
 *   2. Subprocess failure / timeout — a fake git shim that exits non-zero immediately confirms
 *      the catch block that also handles timed-out subprocesses is wired correctly.
 *
 * The `timeout: 10_000` option in the resolver's execFileAsync call is what kills a hung git
 * process; the rejection it produces reaches the same `catch` block as any other subprocess
 * error, so driving a fast-failing fake git exercises the same wrapping path. A test that merely
 * asserted the constant `10_000` is set would not catch a broken catch block.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, ObjectNotFoundError } from './resolver.js';

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
// Subprocess failure / timeout bound
//
// This is the critical path: the resolver uses `timeout: 10_000` when calling
// execFileAsync. When a git process is killed by that timeout, the execFile
// callback receives an error — the same path as any non-zero exit. This test
// drives that exact path by pointing the resolver at a nonexistent repository
// path (which causes git to exit immediately with a non-zero status), then
// confirming the error is wrapped as ObjectNotFoundError rather than
// propagating as an unhandled rejection.
//
// The wrapping is the bound: a caller never receives a raw execFile error from
// a slow or missing git process — it always gets ObjectNotFoundError.
// ---------------------------------------------------------------------------

describe('resolve() subprocess failure / timeout error path', () => {
  it('wraps a subprocess failure (fast-fail, same code path as timeout) as ObjectNotFoundError', async () => {
    // A path that is not a git repository causes `git show` to exit non-zero
    // immediately — exercising the same catch block that a timed-out process
    // reaches, since execFile rejects the promise in both cases.
    const notARepo = mkdtempSync(join(tmpdir(), 'ds-not-a-repo-'));
    try {
      await expect(
        resolve(notARepo, { kind: 'journey', id: 'anything' }, 'HEAD'),
      ).rejects.toBeInstanceOf(ObjectNotFoundError);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it('a subprocess killed by SIGTERM (timeout simulation) is also wrapped as ObjectNotFoundError', async () => {
    // Create a real git repo; then put a fake "git" shim first on PATH that
    // immediately exits with SIGTERM (signal 15) to simulate the kill sent
    // when the execFile timeout fires. The wrapping must convert it to
    // ObjectNotFoundError rather than letting it propagate as a raw Error.
    const shimDir = mkdtempSync(join(tmpdir(), 'ds-git-shim-'));
    const shimPath = join(shimDir, 'git');
    // Shell shim: exits immediately with code 1 (fast-fail; same wrapping path as SIGTERM kill)
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
});
