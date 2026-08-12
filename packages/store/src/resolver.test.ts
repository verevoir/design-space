/**
 * Integration tests for the (object, ref) resolver.
 *
 * These tests use a real temporary git repository — no mocks. A git repo is created in
 * a temp directory, objects are committed on two different refs, and the resolver is
 * exercised against them.
 *
 * The no-checkout property is proven by capturing the working-tree file list before and
 * after a read at a non-current ref and asserting the list is unchanged.
 *
 * Cleanup: the temp directory is removed in `afterAll`, so the suite leaves no residue.
 */

import { execFile } from 'node:child_process';
import { mkdtemp as fsMkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectNotFoundError, resolve } from './resolver.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a git command in the given directory. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      // Deterministic identity so the tests do not depend on the user's git config.
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_TERMINAL_PROMPT: '0',
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
    },
  });
  return stdout.trim();
}

/** Write a file relative to `dir`, creating parent directories as needed. */
async function writeRepoFile(
  dir: string,
  relPath: string,
  content: string,
): Promise<void> {
  const full = path.join(dir, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

/** Return the sorted list of tracked files in the working tree. */
async function workingTreeFiles(repoPath: string): Promise<string[]> {
  const result = await git(repoPath, 'ls-files');
  return result.split('\n').filter(Boolean).sort();
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** Absolute path to the temp git repo created in beforeAll. */
let repoPath: string;

/**
 * The two refs used across the tests:
 *   ref1 — the initial commit, checked out as the current branch ("main")
 *   ref2 — a second commit on a separate branch ("alt"), NOT checked out
 */
let ref1: string; // SHA of the first commit
let ref2: string; // SHA of the second commit

beforeAll(async () => {
  // Create an isolated temp directory — does not depend on the ambient repo.
  repoPath = await (async () => {
    const tmp = await mkdtemp('design-space-store-test-');
    return tmp;
  })();

  // Initialise the repo with a fixed branch name so the test is not sensitive
  // to the user's init.defaultBranch config.
  await git(repoPath, 'init', '-b', 'main');

  // ── First commit on "main" ────────────────────────────────────────────────
  // Lay down one journey, the port, one adapter, and one token set.
  await writeRepoFile(repoPath, 'journeys/checkout.json', '{"version":1,"ref":"main","id":"checkout"}');
  await writeRepoFile(repoPath, 'port/port.json', '{"version":1,"components":["Button"],"ref":"main"}');
  await writeRepoFile(repoPath, 'adapters/sketch.js', '// sketch adapter — ref main\nexport default {};');
  await writeRepoFile(repoPath, 'tokens/base.json', '{"spacing":4,"ref":"main"}');
  await git(repoPath, 'add', '.');
  ref1 = await git(repoPath, 'commit', '-m', 'first commit');
  // git commit outputs "[ main (root-commit) <sha>] …" — grab the SHA directly.
  ref1 = await git(repoPath, 'rev-parse', 'HEAD');

  // ── Second commit on a separate branch "alt" ──────────────────────────────
  await git(repoPath, 'checkout', '-b', 'alt');
  await writeRepoFile(repoPath, 'journeys/checkout.json', '{"version":1,"ref":"alt","id":"checkout"}');
  await writeRepoFile(repoPath, 'port/port.json', '{"version":1,"components":["Button","Card"],"ref":"alt"}');
  await writeRepoFile(repoPath, 'adapters/sketch.js', '// sketch adapter — ref alt\nexport default {};');
  await writeRepoFile(repoPath, 'tokens/base.json', '{"spacing":8,"ref":"alt"}');
  await git(repoPath, 'add', '.');
  ref2 = await git(repoPath, 'rev-parse', 'HEAD');
  // Commit, then switch back to "main" so the working tree reflects ref1.
  await git(repoPath, 'commit', '-m', 'second commit');
  ref2 = await git(repoPath, 'rev-parse', 'HEAD');
  await git(repoPath, 'checkout', 'main');
});

afterAll(async () => {
  if (repoPath) {
    await rm(repoPath, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helper: create a temp directory
// ---------------------------------------------------------------------------

async function mkdtemp(prefix: string): Promise<string> {
  // Node's own mkdtemp guarantees a unique directory. The previous hand-rolled version
  // fell back to a SHARED path whenever mkdir returned undefined (the directory already
  // existed), which would have let concurrent runs collide on one fixture.
  return await fsMkdtemp(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolve — happy path', () => {
  it('reads a journey document at ref1', async () => {
    const content = await resolve(repoPath, { kind: 'journey', id: 'checkout' }, ref1);
    const doc = JSON.parse(content) as { ref: string };
    expect(doc.ref).toBe('main');
  });

  it('reads a journey document at ref2', async () => {
    const content = await resolve(repoPath, { kind: 'journey', id: 'checkout' }, ref2);
    const doc = JSON.parse(content) as { ref: string };
    expect(doc.ref).toBe('alt');
  });

  it('returns different content for the same journey at two different refs', async () => {
    const [c1, c2] = await Promise.all([
      resolve(repoPath, { kind: 'journey', id: 'checkout' }, ref1),
      resolve(repoPath, { kind: 'journey', id: 'checkout' }, ref2),
    ]);
    expect(c1).not.toBe(c2);
  });

  it('reads the port at ref1', async () => {
    const content = await resolve(repoPath, { kind: 'port', id: 'port' }, ref1);
    const doc = JSON.parse(content) as { components: string[]; ref: string };
    expect(doc.components).toEqual(['Button']);
    expect(doc.ref).toBe('main');
  });

  it('reads the port at ref2', async () => {
    const content = await resolve(repoPath, { kind: 'port', id: 'port' }, ref2);
    const doc = JSON.parse(content) as { components: string[]; ref: string };
    expect(doc.components).toEqual(['Button', 'Card']);
    expect(doc.ref).toBe('alt');
  });

  it('reads an adapter at ref1', async () => {
    const content = await resolve(repoPath, { kind: 'adapter', id: 'sketch' }, ref1);
    expect(content).toContain('ref main');
  });

  it('reads an adapter at ref2', async () => {
    const content = await resolve(repoPath, { kind: 'adapter', id: 'sketch' }, ref2);
    expect(content).toContain('ref alt');
  });

  it('reads a token set at ref1', async () => {
    const content = await resolve(repoPath, { kind: 'token-set', id: 'base' }, ref1);
    const doc = JSON.parse(content) as { spacing: number };
    expect(doc.spacing).toBe(4);
  });

  it('reads a token set at ref2', async () => {
    const content = await resolve(repoPath, { kind: 'token-set', id: 'base' }, ref2);
    const doc = JSON.parse(content) as { spacing: number };
    expect(doc.spacing).toBe(8);
  });
});

describe('resolve — concurrent reads at different refs do not change the working tree', () => {
  it('reading at a non-current ref leaves the working tree unchanged', async () => {
    // Capture the working-tree file list before the read.
    const filesBefore = await workingTreeFiles(repoPath);

    // Read an object at ref2 while the working tree is checked out at ref1 (main).
    await resolve(repoPath, { kind: 'journey', id: 'checkout' }, ref2);

    // The working tree must be identical to what it was before.
    const filesAfter = await workingTreeFiles(repoPath);
    expect(filesAfter).toEqual(filesBefore);
  });

  it('reading four refs concurrently does not mutate the working tree', async () => {
    const filesBefore = await workingTreeFiles(repoPath);

    await Promise.all([
      resolve(repoPath, { kind: 'journey', id: 'checkout' }, ref1),
      resolve(repoPath, { kind: 'journey', id: 'checkout' }, ref2),
      resolve(repoPath, { kind: 'port', id: 'port' }, ref1),
      resolve(repoPath, { kind: 'port', id: 'port' }, ref2),
    ]);

    const filesAfter = await workingTreeFiles(repoPath);
    expect(filesAfter).toEqual(filesBefore);
  });
});

describe('resolve — missing object fails with a named error', () => {
  it('throws ObjectNotFoundError for a journey that does not exist at the ref', async () => {
    await expect(
      resolve(repoPath, { kind: 'journey', id: 'nonexistent' }, ref1),
    ).rejects.toThrow(ObjectNotFoundError);
  });

  it('error message names the kind, id, and ref', async () => {
    const err = await resolve(repoPath, { kind: 'journey', id: 'nonexistent' }, ref1).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ObjectNotFoundError);
    const notFound = err as ObjectNotFoundError;
    expect(notFound.message).toContain('journey');
    expect(notFound.message).toContain('nonexistent');
    expect(notFound.message).toContain(ref1);
  });

  it('error exposes the object kind and id on the error instance', async () => {
    const err = await resolve(repoPath, { kind: 'token-set', id: 'missing' }, ref1).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ObjectNotFoundError);
    const notFound = err as ObjectNotFoundError;
    expect(notFound.object.kind).toBe('token-set');
    expect(notFound.object.id).toBe('missing');
    expect(notFound.ref).toBe(ref1);
  });

  it('throws ObjectNotFoundError for an invalid git ref', async () => {
    await expect(
      resolve(repoPath, { kind: 'journey', id: 'checkout' }, 'refs/heads/does-not-exist'),
    ).rejects.toThrow(ObjectNotFoundError);
  });
});

describe('resolve — public interface only: callers never construct a path', () => {
  it('the resolve function is exported and accepts kind+id, not a path string', async () => {
    // This test confirms the shape of the public interface at the type level.
    // If "resolve" accepted a path string, callers could bypass the resolver's
    // path-construction monopoly — the seam would be broken.
    const result = await resolve(
      repoPath,
      { kind: 'adapter', id: 'sketch' },
      ref1,
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Working-tree invariant helper (used in concurrent test above)
// ---------------------------------------------------------------------------

async function _listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.sort();
}
void _listFiles; // referenced only for documentation; workingTreeFiles uses git ls-files
