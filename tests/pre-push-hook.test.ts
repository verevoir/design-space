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

// Bounded: an unbounded spawnSync is exactly the hazard tests/smoke-sh.test.ts documents and
// deliberately avoids elsewhere in this repo ("Using spawnSync would block the event loop") —
// a synchronous call blocks the whole process, so Vitest's own async test-timeout cannot
// preempt a hang here the way it can for a spawn()-based call. 10s is generous headroom over
// what the stubbed npm needs (it exits immediately); it exists to fail this test loudly with a
// diagnosable, aborted/SIGTERM-driven non-zero exit code rather than hanging the CI job
// indefinitely if a future change makes the hook (or the stub) wait on something.
const HOOK_SPAWN_TIMEOUT_MS = 10_000;

function runHook(pathPrefix: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('sh', [HOOK], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${pathPrefix}:${process.env['PATH'] ?? ''}` },
    timeout: HOOK_SPAWN_TIMEOUT_MS,
  });
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// Does this environment have a `timeout` command on PATH? Real check, run once — CI
// (ubuntu-latest) ships coreutils' `timeout`; stock macOS does not, and the hook's own
// fallback branch exists specifically for that case (see .githooks/pre-push's comment).
// runHook() only prepends the stub npm's directory to PATH, so the REAL system PATH —
// and therefore a real `timeout` if this machine has one — is still reachable by the hook.
const HAS_TIMEOUT_CMD = spawnSync('sh', ['-c', 'command -v timeout'], { stdio: 'ignore' }).status === 0;

/** A stub `npm` that sleeps `sleepSeconds` then exits `code` — for exercising a hang. */
async function stubNpmSleep(sleepSeconds: number, code: number): Promise<string> {
  const dir = await tmp('ds-prepush-npm-stub-slow-');
  const path = join(dir, 'npm');
  await writeFile(
    path,
    `#!/bin/sh\necho "stub-npm called: $@"\nsleep ${sleepSeconds}\nexit ${code}\n`,
    'utf-8',
  );
  await chmod(path, 0o755);
  return dir;
}

function runHookWithEnv(
  pathPrefix: string,
  extraEnv: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('sh', [HOOK], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${pathPrefix}:${process.env['PATH'] ?? ''}`, ...extraEnv },
    timeout: HOOK_SPAWN_TIMEOUT_MS,
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
    // Anchored to the failure-only sentence, not the bare substring '--no-verify' — the hook
    // also prints '--no-verify' unconditionally in its startup line (present on every run,
    // success or failure), so a loose toContain('--no-verify') is satisfied by that line alone
    // and cannot fail even if this failure-specific bypass instruction is deleted entirely.
    // review (testing) rejection against 7624b6a, verified by mutation: deleting the line below
    // from the hook left the old assertion green.
    expect(r.stdout).toContain(
      'Fix the failure above, or bypass deliberately with: git push --no-verify',
    );
  });
});

// ---------------------------------------------------------------------------
// npm run verify is bounded — review (resilience) rejection against 7aab3d3: the hook's own
// real invocation had no timeout, unlike the test harness's spawnSync call above, so a hang in
// build/test/lint/exit-contracts would block git push forever with no diagnosable signal.
// ---------------------------------------------------------------------------

(HAS_TIMEOUT_CMD ? describe : describe.skip)(
  '.githooks/pre-push — bounds npm run verify with `timeout` (this machine has one on PATH)',
  () => {
    it('kills a hanging npm run verify after the configured bound, rather than blocking the push forever', async () => {
      // The stub sleeps 9s; the bound is overridden to 3s, so `timeout` kills it with several
      // seconds of margin inside this test's own 10s HOOK_SPAWN_TIMEOUT_MS backstop — never
      // depends on that backstop firing. 3s (not something tighter like 1s) is deliberate: under
      // a loaded test run this process's own spawn/exec overhead alone has been observed to
      // exceed 1s, which would kill even a genuinely-fast run and make the OTHER test below
      // ("does not disturb") flaky for a reason that has nothing to do with the hook's logic.
      const dir = await stubNpmSleep(9, 0);
      const r = runHookWithEnv(dir, { PRE_PUSH_VERIFY_TIMEOUT_S: '3' });

      expect(r.code).not.toBe(0);
      expect(r.stdout).toContain('did not complete within 3s and was killed');
    });

    it('does not disturb a normal, fast run — the bound only matters when something hangs', async () => {
      // 5s of headroom over an instant no-op stub, generous enough to absorb this process's own
      // spawn/exec overhead under load without the bound itself becoming the flaky variable.
      const dir = await stubNpm(0);
      const r = runHookWithEnv(dir, { PRE_PUSH_VERIFY_TIMEOUT_S: '5' });

      expect(r.code).toBe(0);
      expect(r.stdout).not.toContain('was killed');
    });
  },
);

describe('.githooks/pre-push — the no-`timeout`-on-PATH fallback', () => {
  // Forcing `timeout` off a child's PATH reliably and portably (independent of which OS/distro
  // this machine is, and of merged-/bin-vs-/usr/bin layouts) is not practical from here — so
  // unlike the bound-and-kill behaviour above, this fallback branch's own RUNTIME is not
  // exercised end-to-end. What is checked is that the branch and its two distinct messages
  // genuinely exist in the shipped hook, so the source cannot silently lose the fallback without
  // this failing — a static pin, honestly labelled as one rather than passed off as behavioural
  // coverage it is not.
  it('the source contains both the timeout-present and timeout-absent branches, each with its own message', () => {
    const content = readFileSync(HOOK, 'utf-8');
    expect(content).toContain('command -v timeout');
    expect(content).toContain("'timeout' is not on PATH");
    expect(content).toContain('did not complete within');
  });
});
