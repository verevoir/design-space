/**
 * Tests for the (object, ref) resolver.
 *
 * Three layers:
 *   1. Integration — exercised against a real temporary git repository so git-show, the object
 *      layout and the no-checkout guarantee are confirmed against an actual process.
 *   2. Subprocess failure classification — fake git shims that exit with a normal code or a
 *      signal confirm that the resolver distinguishes the two failure kinds correctly:
 *        - a non-zero normal exit  → ObjectNotFoundError (git answered "not there")
 *        - a signal kill           → ObjectLookupError   (question unanswered; may retry)
 *   3. Input validation — confirms that invalid ref/root values are rejected at the boundary
 *      with InvalidRefError before any git subprocess is spawned.
 *
 * The `timeout: 10_000` option in the resolver's execFileAsync call sends SIGTERM when a
 * subprocess runs too long; the rejection it produces sets `signal: 'SIGTERM'` on the error
 * object, which is exactly what ObjectLookupError tests for. The signal-kill test below
 * exercises that branch via a shim that sends SIGTERM to itself, without waiting 10 s.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, ObjectNotFoundError, ObjectLookupError, InvalidRefError } from './resolver.js';

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

  // Also create a rooted collection for the root-option tests.
  mkdirSync(join(repoDir, 'collections'), { recursive: true });
  mkdirSync(join(repoDir, 'collections', 'journeys'), { recursive: true });
  writeFileSync(
    join(repoDir, 'collections', 'journeys', 'rooted-journey.json'),
    JSON.stringify({ id: 'rooted-journey', v: 10 }),
  );

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

  it('reading at a non-current ref leaves the working tree and index unchanged (no-checkout guarantee)', async () => {
    // ADR 0003 is load-bearing: rendering reads at a ref without checking anything out,
    // so all four variation columns can be read concurrently from one working tree.
    // This test proves that guarantee holds against a real git subprocess.
    //
    // Strategy: capture the full working-tree status and the index fingerprint (ls-files -s)
    // before the read, perform the read at the first (non-HEAD) commit, then capture again.
    // If git-show touched the index or the working tree, the before/after snapshots will differ.
    const statusBefore = execSync('git status --porcelain', { cwd: repoDir, stdio: 'pipe' }).toString();
    const indexBefore = execSync('git ls-files -s', { cwd: repoDir, stdio: 'pipe' }).toString();

    // Read at commitSha — which is NOT HEAD (commitShaToo is HEAD). A checkout would
    // mutate both the index and the working tree to the first commit's state.
    await resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha);

    const statusAfter = execSync('git status --porcelain', { cwd: repoDir, stdio: 'pipe' }).toString();
    const indexAfter = execSync('git ls-files -s', { cwd: repoDir, stdio: 'pipe' }).toString();

    expect(statusAfter).toBe(statusBefore);
    expect(indexAfter).toBe(indexBefore);
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
// root option — scopes the lookup to a subdirectory
// ---------------------------------------------------------------------------

describe('resolve() with the root option', () => {
  it('reads an object from a subdirectory when root is supplied', async () => {
    const raw = await resolve(
      repoDir,
      { kind: 'journey', id: 'rooted-journey' },
      commitSha,
      { root: 'collections' },
    );
    const parsed = JSON.parse(raw) as { id: string; v: number };
    expect(parsed.id).toBe('rooted-journey');
    expect(parsed.v).toBe(10);
  });

  it('strips a trailing slash from root before building the path', async () => {
    // 'collections/' (trailing slash) must resolve the same object as 'collections'.
    const raw = await resolve(
      repoDir,
      { kind: 'journey', id: 'rooted-journey' },
      commitSha,
      { root: 'collections/' },
    );
    const parsed = JSON.parse(raw) as { id: string; v: number };
    expect(parsed.id).toBe('rooted-journey');
  });

  it('throws ObjectNotFoundError when the object is absent under the given root', async () => {
    await expect(
      resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha, { root: 'collections' }),
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

// ---------------------------------------------------------------------------
// Input validation — ref and root are rejected at the boundary
//
// A bad value throws InvalidRefError immediately; no git subprocess is spawned.
// These tests prove concrete attack vectors are rejected:
//   - a ref beginning with '-' (argument-injection via git option syntax)
//   - a root containing '..' (path traversal outside the intended collection)
// ---------------------------------------------------------------------------

describe('resolve() input validation', () => {
  describe('ref validation', () => {
    it('rejects a ref that begins with "-" (argument-injection guard)', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, '--upload-pack=x'),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('InvalidRefError for a leading-dash ref names the invalid value', async () => {
      const err = await resolve(repoDir, { kind: 'journey', id: 'test-journey' }, '--upload-pack=x')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidRefError);
      expect((err as Error).message).toContain('--upload-pack=x');
    });

    it('rejects a ref containing ".." (git range-operator guard)', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, 'main..evil'),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('rejects an empty ref', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, ''),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('rejects a ref containing characters outside the allowed set', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, 'main;evil'),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('rejects a ref containing a backslash (SAFE_REF admits only [A-Za-z0-9._/-])', async () => {
      // A backslash is not in the documented character set for refs. This test
      // pins the fix: the character class must not include a backslash.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, 'a\\b'),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('accepts a valid branch name ref', async () => {
      // The ref does not exist in the repo, so we expect ObjectNotFoundError —
      // but NOT InvalidRefError. This proves the allow-pattern passes valid refs.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, 'valid-branch'),
      ).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it('accepts a commit SHA ref', async () => {
      // commitSha is a real SHA in the repo — expect successful resolution.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha),
      ).resolves.toBeDefined();
    });
  });

  describe('root validation', () => {
    it('rejects a root containing ".." (path-traversal guard)', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha, { root: '../..' }),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('InvalidRefError for a dotdot root names the invalid value', async () => {
      const err = await resolve(
        repoDir,
        { kind: 'journey', id: 'test-journey' },
        commitSha,
        { root: '../..' },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidRefError);
      expect((err as Error).message).toContain('../..');
    });

    it('rejects a root that begins with "-"', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha, { root: '-evil' }),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('rejects a root with an empty segment (leading slash)', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha, { root: '/absolute/path' }),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('rejects a root with consecutive slashes (empty inner segment)', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha, { root: 'a//b' }),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('accepts an absent root (no root option)', async () => {
      // resolve without options should not throw InvalidRefError
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha),
      ).resolves.toBeDefined();
    });

    it('accepts a valid root path', async () => {
      // 'collections' is a real directory; rooted-journey.json is in it.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'rooted-journey' }, commitSha, { root: 'collections' }),
      ).resolves.toBeDefined();
    });

    it('rejects a root containing a backslash (SAFE_ROOT admits only [A-Za-z0-9._/-])', async () => {
      // A backslash is not in the documented character set for root paths. This test
      // pins the fix: the character class must not include a backslash.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha, { root: 'a\\b' }),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });
  });

  // ---------------------------------------------------------------------------
  // id validation — objectPath() interpolates id directly into the git path,
  // so an id like '../../etc' would walk outside the intended per-kind
  // collection. These tests prove that class of attack is rejected at the same
  // boundary as ref and root, before any git subprocess is spawned.
  // ---------------------------------------------------------------------------

  describe('id validation', () => {
    it('rejects an id containing ".." (path-traversal guard)', async () => {
      // '../../etc' would construct e.g. 'journeys/../../etc.json' — outside the collection.
      await expect(
        resolve(repoDir, { kind: 'journey', id: '../../etc' }, commitSha),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('InvalidRefError for a dotdot id names the invalid value', async () => {
      const err = await resolve(repoDir, { kind: 'journey', id: '../../etc' }, commitSha)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidRefError);
      expect((err as Error).message).toContain('../../etc');
    });

    it('rejects an id that begins with "-" (argument-injection guard)', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: '-evil' }, commitSha),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('InvalidRefError for a leading-dash id names the invalid value', async () => {
      const err = await resolve(repoDir, { kind: 'journey', id: '-evil' }, commitSha)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidRefError);
      expect((err as Error).message).toContain('-evil');
    });

    it('rejects an id containing "/" (path-separator guard)', async () => {
      // 'sub/evil' would construct e.g. 'journeys/sub/evil.json' — a path, not a name.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'sub/evil' }, commitSha),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('rejects an empty id', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: '' }, commitSha),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('rejects an id containing characters outside the allowed set (e.g. ";")', async () => {
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'ok;evil' }, commitSha),
      ).rejects.toBeInstanceOf(InvalidRefError);
    });

    it('accepts a simple alphanumeric id', async () => {
      // 'test-journey' exists in the repo — expect successful resolution, not InvalidRefError.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'test-journey' }, commitSha),
      ).resolves.toBeDefined();
    });

    it('accepts an id with hyphens and underscores', async () => {
      // Valid ids with hyphens are the common case (e.g. 'broadband-switch').
      // 'nonexistent_id' will produce ObjectNotFoundError, proving InvalidRefError is NOT thrown.
      await expect(
        resolve(repoDir, { kind: 'journey', id: 'valid_id-name' }, commitSha),
      ).rejects.toBeInstanceOf(ObjectNotFoundError);
    });
  });
});
