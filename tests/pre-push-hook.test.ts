import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// .githooks/pre-push is purpose-built behaviour with no test — exactly the shape review
// (testing) rejected three times on PR #23 (mutation-resistant gaps in gate.ts's contrast
// checks). A hook nothing asserts can regress silently in three distinct ways this file checks
// for separately: the file can disappear, it can lose the executable bit (which is the single
// worst failure mode for a hook — git silently skips a non-executable hook, so the seatbelt
// stops working with no error anywhere), or its body can stop doing what it says it does.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(REPO_ROOT, '.githooks', 'pre-push');

describe('.githooks/pre-push — static checks', () => {
  it('exists on disk', () => {
    expect(() => statSync(HOOK)).not.toThrow();
  });

  it('carries the executable bit — without it git silently skips the hook, which is not an error anyone sees', () => {
    const mode = statSync(HOOK).mode;
    expect(mode & 0o111, 'the file exists but is not executable by anyone — git would silently skip it as a hook').not.toBe(0);
  });

  it('invokes npm run verify — the gate this hook exists to run', () => {
    expect(readFileSync(HOOK, 'utf-8')).toContain('npm run verify');
  });

  it('documents the bypass and states plainly that this is a seatbelt, not enforcement', () => {
    const content = readFileSync(HOOK, 'utf-8');
    expect(content).toContain('--no-verify');
    expect(content.toUpperCase()).toContain('SEATBELT');
    expect(content.toUpperCase()).toContain('NOT ENFORCEMENT');
  });
});

// ---------------------------------------------------------------------------
// Behaviour — driven with a stub `npm` on PATH, the same convention
// tests/promote-scripts.test.ts and tests/smoke-sh.test.ts use for every other script in this
// repo: the real subprocess is run, only the dependency it calls out to is a controlled double.
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A stub `npm` that only understands `run verify`, echoes a marker, and exits `code`. */
async function stubNpm(code: number): Promise<string> {
  const dir = await tmp('ds-prepush-npm-stub-');
  const path = join(dir, 'npm');
  await writeFile(
    path,
    `#!/bin/sh\necho "stub-npm called: $@"\nexit ${code}\n`,
    'utf-8',
  );
  await chmod(path, 0o755);
  return dir;
}

function runHook(pathPrefix: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('sh', [HOOK], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${pathPrefix}:${process.env['PATH'] ?? ''}` },
  });
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

describe('.githooks/pre-push — behaviour, against a stub npm', () => {
  it('actually calls npm run verify, not some other command', async () => {
    const dir = await stubNpm(0);
    const r = runHook(dir);

    expect(r.stdout).toContain('stub-npm called: run verify');
  });

  it('exits 0 and does not print the BLOCKED message when npm run verify succeeds', async () => {
    const dir = await stubNpm(0);
    const r = runHook(dir);

    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('BLOCKED');
  });

  it('propagates npm run verify\'s own non-zero exit code, not a fixed one', async () => {
    // Mutation-resistant: a hook that always exits 1 on failure, rather than propagating the
    // real code, would still make this describe block's other assertions pass — only a
    // specific, non-1 code proves the propagation rather than a hardcoded failure exit.
    const dir = await stubNpm(7);
    const r = runHook(dir);

    expect(r.code).toBe(7);
  });

  it('prints the BLOCKED message and the bypass instruction when npm run verify fails', async () => {
    const dir = await stubNpm(3);
    const r = runHook(dir);

    expect(r.stdout).toContain('BLOCKED');
    expect(r.stdout).toContain('--no-verify');
  });
});
