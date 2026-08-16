import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, mkdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  describeSpawnResult,
  DEFAULT_SPAWN_TIMEOUT_MS,
  DEFAULT_KILL_GRACE_MS,
  spawnTimeoutMs,
  killGraceMs,
  stageVerifiedCopy,
  ALLOWED_SPAWN_ENV_VARS,
} from '../scripts/verified-pregate.mjs';

// verified-pregate.mjs is what carries CLAUDE_CODE_OAUTH_TOKEN and AIGENCY_GUARDRAILS_TOKEN
// into ../capabilities/scripts/run-pregate.mjs, a script that lives outside this repository and
// is therefore not versioned with the code it reviews. What is tested here is that nothing gets
// those credentials — nothing is spawned at all — unless the sibling script matches a digest
// pinned in THIS repository, that what actually runs is a verified COPY rather than the
// original mutable path, and that a spawn failure or a hang is reported rather than swallowed.
// Every scenario below uses disposable fixtures via PREGATE_TARGET_SCRIPT / PREGATE_PIN_FILE,
// never the real sibling checkout, so these tests are independent of whatever ../capabilities
// happens to contain when CI runs.

const WRAPPER = fileURLToPath(new URL('../scripts/verified-pregate.mjs', import.meta.url));

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** A fixture "sibling script" that, if actually spawned, writes a marker file and echoes its
 * own argv — proof both of invocation and of correct argument forwarding. */
async function fixtureTarget(dir: string, body = ''): Promise<string> {
  const path = join(dir, 'run-pregate.mjs');
  await writeFile(
    path,
    body ||
      [
        "import { writeFileSync } from 'node:fs';",
        "import { join, dirname } from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        "const here = dirname(fileURLToPath(import.meta.url));",
        "writeFileSync(join(here, 'invoked.marker'), process.argv.slice(2).join(' '));",
        "console.log('ran with: ' + process.argv.slice(2).join(' '));",
        'process.exit(0);',
      ].join('\n'),
    'utf-8',
  );
  return path;
}

async function pinFor(dir: string, targetPath: string): Promise<string> {
  const digest = createHash('sha256').update(await readFile(targetPath)).digest('hex');
  const pinPath = join(dir, 'pin.sha256');
  await writeFile(pinPath, `${digest}\n`, 'utf-8');
  return pinPath;
}

function runWrapper(env: Record<string, string>, args: string[] = [], cwd?: string) {
  const res = spawnSync(process.execPath, [WRAPPER, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    cwd,
  });
  return { code: res.status ?? 1, out: res.stdout ?? '', err: res.stderr ?? '' };
}

describe('verified-pregate.mjs', () => {
  it('refuses when there is no pin file at all', async () => {
    const dir = await tmp('ds-vp-nopin-');
    const target = await fixtureTarget(dir);

    const r = runWrapper({
      PREGATE_TARGET_SCRIPT: target,
      PREGATE_PIN_FILE: join(dir, 'does-not-exist.sha256'),
    });

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('no pin file');
    expect(existsSync(join(dir, 'invoked.marker'))).toBe(false);
  });

  it('refuses when the pin file is not a well-formed digest', async () => {
    const dir = await tmp('ds-vp-badpin-');
    const target = await fixtureTarget(dir);
    const pinPath = join(dir, 'pin.sha256');
    await writeFile(pinPath, 'not-a-digest\n', 'utf-8');

    const r = runWrapper({ PREGATE_TARGET_SCRIPT: target, PREGATE_PIN_FILE: pinPath });

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('well-formed');
    expect(existsSync(join(dir, 'invoked.marker'))).toBe(false);
  });

  it('refuses when the target script does not exist, even with a well-formed pin', async () => {
    const dir = await tmp('ds-vp-notarget-');
    // A pin that is well-formed but names a file that was never written.
    const pinPath = join(dir, 'pin.sha256');
    await writeFile(pinPath, `${'a'.repeat(64)}\n`, 'utf-8');

    const r = runWrapper({
      PREGATE_TARGET_SCRIPT: join(dir, 'missing.mjs'),
      PREGATE_PIN_FILE: pinPath,
    });

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('does not exist');
  });

  it('refuses on a digest mismatch — the sibling checkout has changed since the pin was set', async () => {
    const dir = await tmp('ds-vp-mismatch-');
    const target = await fixtureTarget(dir);
    const pinPath = join(dir, 'pin.sha256');
    // A pin that does not match this target's real digest.
    await writeFile(pinPath, `${'b'.repeat(64)}\n`, 'utf-8');

    const r = runWrapper({ PREGATE_TARGET_SCRIPT: target, PREGATE_PIN_FILE: pinPath });

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('does not match the pinned digest');
    expect(existsSync(join(dir, 'invoked.marker'))).toBe(false);
  });

  it('proves nothing is spawned on ANY refusal path, not just that no marker was left', async () => {
    // Stronger than the marker check above: the fixture target is made non-executable-looking
    // (a script that would throw immediately if node ever tried to run it), so if the wrapper
    // spawned it despite the mismatch, this process would exit non-zero for a DIFFERENT reason
    // than the one asserted.
    const dir = await tmp('ds-vp-noexec-');
    const target = await fixtureTarget(dir, "throw new Error('must never run');");
    const pinPath = join(dir, 'pin.sha256');
    await writeFile(pinPath, `${'c'.repeat(64)}\n`, 'utf-8');

    const r = runWrapper({ PREGATE_TARGET_SCRIPT: target, PREGATE_PIN_FILE: pinPath });

    expect(r.err).toContain('does not match the pinned digest');
    expect(r.err).not.toContain('must never run');
  });

  it('spawns the target and forwards arguments when the digest matches exactly', async () => {
    const dir = await tmp('ds-vp-match-');
    const target = await fixtureTarget(dir);
    const pinPath = await pinFor(dir, target);

    const r = runWrapper(
      { PREGATE_TARGET_SCRIPT: target, PREGATE_PIN_FILE: pinPath },
      ['--base', 'main', '--lens-timeout', '480'],
    );

    expect(r.code).toBe(0);
    expect(r.out).toContain('ran with: --base main --lens-timeout 480');
    expect(await readFile(join(dir, 'invoked.marker'), 'utf-8')).toBe('--base main --lens-timeout 480');
  });

  it('propagates a non-zero exit from the target rather than swallowing it', async () => {
    const dir = await tmp('ds-vp-failexit-');
    const target = await fixtureTarget(dir, "process.exit(7);");
    const pinPath = await pinFor(dir, target);

    const r = runWrapper({ PREGATE_TARGET_SCRIPT: target, PREGATE_PIN_FILE: pinPath });

    expect(r.code).toBe(7);
  });

  it('resolves a relative PREGATE_PIN_FILE against the repository root, not cwd — proven by running from elsewhere', async () => {
    // scripts/pregate.sha256 is exactly this shape in real use — a path relative to the repo,
    // not to wherever the release step happens to be invoked from. The previous version of this
    // test spawned the wrapper WITHOUT changing cwd away from the repo root, so root-relative
    // and cwd-relative resolution coincided and the test could not fail under a wrong
    // implementation. Running from a genuinely different cwd is what makes the two diverge.
    const dir = await tmp('ds-vp-relpin-');
    const target = await fixtureTarget(dir);
    const digest = createHash('sha256').update(await readFile(target)).digest('hex');
    const repoRoot = dirname(dirname(WRAPPER));
    const relDir = '.tmp-verified-pregate-test-pin';
    const absDir = join(repoRoot, relDir);
    await mkdir(absDir, { recursive: true });
    await writeFile(join(absDir, 'pin.sha256'), `${digest}\n`, 'utf-8');

    const elsewhere = await tmp('ds-vp-relpin-elsewhere-');

    try {
      // cwd is `elsewhere`, nowhere near repoRoot. A cwd-relative resolution would look for
      // `elsewhere/.tmp-verified-pregate-test-pin/pin.sha256`, which does not exist, and refuse.
      const r = runWrapper(
        {
          PREGATE_TARGET_SCRIPT: target,
          PREGATE_PIN_FILE: join(relDir, 'pin.sha256'),
        },
        [],
        elsewhere,
      );

      expect(r.code).toBe(0);
    } finally {
      await rm(absDir, { recursive: true, force: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('resolves a relative PREGATE_TARGET_SCRIPT against the repository root, not cwd — proven by running from elsewhere', async () => {
    // The asymmetric twin of the PREGATE_PIN_FILE test above: resolveTarget and resolvePinFile
    // share the exact same `resolve(REPO_ROOT, env.X ?? default)` shape, but only the pin side
    // had a test that could actually distinguish REPO_ROOT-relative from cwd-relative — the
    // target side had none at all. Same construction, same reason: running from a genuinely
    // different cwd than REPO_ROOT is what makes the two resolution strategies diverge.
    const dir = await tmp('ds-vp-reltarget-');
    const fixture = await fixtureTarget(dir);
    const bytes = await readFile(fixture);
    const digest = createHash('sha256').update(bytes).digest('hex');

    const repoRoot = dirname(dirname(WRAPPER));
    const relDir = '.tmp-verified-pregate-test-target';
    const absDir = join(repoRoot, relDir);
    await mkdir(absDir, { recursive: true });
    await writeFile(join(absDir, 'run-pregate.mjs'), bytes);
    // Absolute, so this test isolates TARGET resolution — PIN_FILE resolution is already
    // covered by the test above and is not what this one is proving.
    const pinPath = join(absDir, 'pin.sha256');
    await writeFile(pinPath, `${digest}\n`, 'utf-8');

    const elsewhere = await tmp('ds-vp-reltarget-elsewhere-');

    try {
      // cwd is `elsewhere`. A cwd-relative resolveTarget would look for
      // `elsewhere/.tmp-verified-pregate-test-target/run-pregate.mjs`, which does not exist,
      // and refuse with "does not exist" rather than spawning successfully.
      const r = runWrapper(
        {
          PREGATE_TARGET_SCRIPT: join(relDir, 'run-pregate.mjs'),
          PREGATE_PIN_FILE: pinPath,
        },
        [],
        elsewhere,
      );

      expect(r.code).toBe(0);
      expect(r.err).not.toContain('does not exist');
    } finally {
      await rm(absDir, { recursive: true, force: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("this repository's own committed pin is a well-formed SHA-256 digest", async () => {
    // Not a claim that the pin is CURRENT against the sibling checkout — that comparison is
    // deliberately not made here, or CI (which has no sibling checkout at all) would fail on
    // every run. Only that the committed file is well-formed, so the wrapper's own shape check
    // has something real to compare against in normal use.
    const repoRoot = dirname(dirname(WRAPPER));
    const pinned = (await readFile(join(repoRoot, 'scripts', 'pregate.sha256'), 'utf-8')).trim();

    expect(pinned).toMatch(/^[0-9a-f]{64}$/);
  });

  // -------------------------------------------------------------------------
  // TOCTOU — what actually gets executed is a verified COPY, never TARGET again
  // -------------------------------------------------------------------------

  it('executes a copy of the verified bytes in TARGET\'s own directory, never TARGET again — and cleans it up', async () => {
    const dir = await tmp('ds-vp-toctou-');
    const target = join(dir, 'run-pregate.mjs');
    await writeFile(
      target,
      [
        "import { fileURLToPath } from 'node:url';",
        "console.log('SELF_PATH=' + fileURLToPath(import.meta.url));",
        'process.exit(0);',
      ].join('\n'),
      'utf-8',
    );
    const pinPath = await pinFor(dir, target);

    const r = runWrapper({ PREGATE_TARGET_SCRIPT: target, PREGATE_PIN_FILE: pinPath });

    expect(r.code).toBe(0);
    const selfPathLine = r.out.split('\n').find((l) => l.startsWith('SELF_PATH='));
    expect(selfPathLine).toBeDefined();
    const executedPath = selfPathLine!.slice('SELF_PATH='.length);

    // The whole point: what actually ran is NOT the original, still-mutable TARGET path — it is
    // a fresh copy of the exact bytes already verified. A wrapper that spawned TARGET directly
    // would fail this.
    expect(executedPath).not.toBe(target);
    // But it sits in the SAME directory as TARGET, so run-pregate.mjs's own
    // dirname(import.meta.url) self-location still resolves to the real sibling checkout.
    // realpath on both sides: macOS resolves os.tmpdir() through a /var -> /private/var
    // symlink, which the executed script's own reported path already sees through.
    expect(dirname(executedPath)).toBe(await realpath(dir));
    // And it is cleaned up afterward — no stray verified copy left behind.
    expect(existsSync(executedPath)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The credentialed spawn is bounded, and a spawn-level failure is legible
  // -------------------------------------------------------------------------

  it('kills a hung panel after its own bound and reports the signal, rather than waiting forever', async () => {
    const dir = await tmp('ds-vp-hang-');
    // Stays alive indefinitely without ever exiting.
    const target = await fixtureTarget(dir, 'setInterval(() => {}, 1000);');
    const pinPath = await pinFor(dir, target);

    const r = runWrapper({
      PREGATE_TARGET_SCRIPT: target,
      PREGATE_PIN_FILE: pinPath,
      PREGATE_SPAWN_TIMEOUT_MS: '300',
    });

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('did not finish');
    expect(r.err).toContain("wrapper's own");
  });

  it('spawnTimeoutMs honours PREGATE_SPAWN_TIMEOUT_MS and falls back on a bad value', () => {
    expect(spawnTimeoutMs({ PREGATE_SPAWN_TIMEOUT_MS: '1234' })).toBe(1234);
    expect(spawnTimeoutMs({ PREGATE_SPAWN_TIMEOUT_MS: 'not-a-number' })).toBe(DEFAULT_SPAWN_TIMEOUT_MS);
    expect(spawnTimeoutMs({})).toBe(DEFAULT_SPAWN_TIMEOUT_MS);
  });

  it('killGraceMs honours PREGATE_KILL_GRACE_MS and falls back on a bad value', () => {
    expect(killGraceMs({ PREGATE_KILL_GRACE_MS: '500' })).toBe(500);
    expect(killGraceMs({ PREGATE_KILL_GRACE_MS: 'nope' })).toBe(DEFAULT_KILL_GRACE_MS);
    expect(killGraceMs({})).toBe(DEFAULT_KILL_GRACE_MS);
  });

  // -------------------------------------------------------------------------
  // THE LIVE-COST DEFECT: a timeout must kill the whole process GROUP, not just the
  // immediate child. run-pregate.mjs spawns nested per-lens node processes of its own,
  // undetached, so they inherit their parent's process group by ordinary OS behaviour. A
  // wrapper that only ever signals its direct child by pid leaves those nested processes
  // orphaned and still running — still making paid model calls — after this wrapper has
  // already given up and reported failure. This must distinguish killing the CHILD from
  // killing the GROUP, or it is a hollow assertion that passes under both the old and new
  // behaviour.
  // -------------------------------------------------------------------------

  it("kills the WHOLE process group on timeout — a nested grandchild does not outlive it", async () => {
    const dir = await tmp('ds-vp-group-');
    const pidFile = join(dir, 'grandchild.pid');
    const heartbeatFile = join(dir, 'heartbeat.txt');

    // The nested process run-pregate.mjs itself spawns, in miniature: writes its own pid so
    // the test can check on it later, then proves it is still alive by growing a file every
    // 100ms. Spawned WITHOUT detached — the realistic shape, per the ALLOWED_SPAWN_ENV_VARS
    // doc comment's own quote of run-pregate.mjs's `spawn('node', [plan.bin, ...])` call.
    const grandchildScript = join(dir, 'grandchild.mjs');
    await writeFile(
      grandchildScript,
      [
        "import { appendFileSync } from 'node:fs';",
        'let n = 0;',
        `setInterval(() => { appendFileSync(${JSON.stringify(heartbeatFile)}, String(n++) + '\\n'); }, 100);`,
      ].join('\n'),
      'utf-8',
    );

    // The fixture "panel": spawns the grandchild above, records its pid, then hangs forever
    // itself — never exiting on its own, so only the wrapper's OWN timeout ends this run,
    // exactly like the real hung-lens case this defect was found against.
    const target = await fixtureTarget(
      dir,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        `const gc = spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { stdio: 'ignore' });`,
        `writeFileSync(${JSON.stringify(pidFile)}, String(gc.pid));`,
        'gc.unref();',
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    );
    const pinPath = await pinFor(dir, target);

    const r = runWrapper({
      PREGATE_TARGET_SCRIPT: target,
      PREGATE_PIN_FILE: pinPath,
      PREGATE_SPAWN_TIMEOUT_MS: '300',
      PREGATE_KILL_GRACE_MS: '300',
    });

    expect(r.code).not.toBe(0);

    const grandchildPid = Number((await readFile(pidFile, 'utf-8')).trim());
    const isAlive = () => {
      try {
        process.kill(grandchildPid, 0);
        return true;
      } catch {
        return false;
      }
    };

    // A moment past the wrapper's own return for the OS to actually deliver the signal.
    await new Promise((res) => setTimeout(res, 600));

    expect(isAlive()).toBe(false);

    // Corroborating evidence, not merely the pid check, which a reused pid could satisfy by
    // accident: the heartbeat file must have genuinely STOPPED growing, not merely exist.
    const before = await readFile(heartbeatFile, 'utf-8');
    await new Promise((res) => setTimeout(res, 400));
    const after = await readFile(heartbeatFile, 'utf-8');
    expect(after).toBe(before);
  });

  // -------------------------------------------------------------------------
  // The child receives an explicit, minimal environment — never this process's own,
  // wholesale. Asserted on the child's OWN reported environment, not merely that the tokens
  // are present, which would pass just as happily under a full-inheritance leak.
  // -------------------------------------------------------------------------

  it('spawns the target with an explicit, minimal environment — not full inheritance', async () => {
    const dir = await tmp('ds-vp-envleak-');
    const target = join(dir, 'run-pregate.mjs');
    await writeFile(
      target,
      "console.log('ENV_JSON=' + JSON.stringify(process.env)); process.exit(0);",
      'utf-8',
    );
    const pinPath = await pinFor(dir, target);

    const r = runWrapper({
      PREGATE_TARGET_SCRIPT: target,
      PREGATE_PIN_FILE: pinPath,
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-test-token',
      AIGENCY_GUARDRAILS_TOKEN: 'guardrails-test-token',
      // Not in ALLOWED_SPAWN_ENV_VARS. If this reaches the child, inheritance leaked.
      THIS_MUST_NOT_LEAK: 'super-secret-should-not-travel',
    });

    expect(r.code).toBe(0);
    const line = r.out.split('\n').find((l) => l.startsWith('ENV_JSON='));
    expect(line).toBeDefined();
    const childEnv = JSON.parse(line!.slice('ENV_JSON='.length));

    expect(childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test-token');
    expect(childEnv.AIGENCY_GUARDRAILS_TOKEN).toBe('guardrails-test-token');
    expect(childEnv.THIS_MUST_NOT_LEAK).toBeUndefined();
    // Every key the child received is a member of the allowed set — not merely that the two
    // tokens are among them, but that NOTHING beyond the declared set travelled at all.
    //
    // __CF_USER_TEXT_ENCODING is excluded from that check, empirically rather than assumed: it
    // showed up here even though it is in neither ALLOWED_SPAWN_ENV_VARS nor anything this test
    // set, which means macOS/CoreFoundation injects it into a spawned process's own environ
    // AFTER exec, independent of the envp this wrapper actually passed. It is platform noise
    // this wrapper does not control and did not forward — unlike THIS_MUST_NOT_LEAK above,
    // which genuinely would have appeared here had minimalEnv() not filtered it.
    const PLATFORM_INJECTED_NOISE = ['__CF_USER_TEXT_ENCODING'];
    const unexpected = Object.keys(childEnv).filter(
      (k) => !(ALLOWED_SPAWN_ENV_VARS as readonly string[]).includes(k) && !PLATFORM_INJECTED_NOISE.includes(k),
    );
    expect(unexpected).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Staging the verified copy can fail (a full disk, a read-only directory) — previously
  // reachable only by luck. stageVerifiedCopy takes an injectable `write`, so this is now a
  // pure, deterministic test rather than one that depends on the filesystem's own failure modes.
  // -------------------------------------------------------------------------

  describe('stageVerifiedCopy — pure, so a staging failure never has to be reproduced live', () => {
    it('reports a failure to stage the verified copy, rather than crashing or hanging', () => {
      const failingWrite = () => {
        throw new Error('ENOSPC: no space left on device');
      };

      expect(() =>
        stageVerifiedCopy('/some/dir', Buffer.from('x'), { write: failingWrite }),
      ).toThrow(/could not stage a verified copy.*ENOSPC/);
    });

    it('returns a real path inside targetDir when the write succeeds', () => {
      const written: string[] = [];
      const recordingWrite = (path: string) => {
        written.push(path);
      };

      const copyPath = stageVerifiedCopy('/some/dir', Buffer.from('x'), { write: recordingWrite });

      expect(copyPath.startsWith('/some/dir/')).toBe(true);
      expect(written).toEqual([copyPath]);
    });
  });

  describe('describeSpawnResult — pure, so a spawn failure never has to be reproduced live', () => {
    it('reports a spawn that could not even start, rather than a bare exit(1)', () => {
      const outcome = describeSpawnResult({ error: new Error('spawn ENOENT'), status: null, signal: null });

      expect(outcome.exitCode).toBe(1);
      expect(outcome.message).toContain('could not start');
      expect(outcome.message).toContain('spawn ENOENT');
    });

    it('reports a signal-killed child, naming this wrapper\'s own bound', () => {
      const outcome = describeSpawnResult({ error: null, status: null, signal: 'SIGTERM' }, 300);

      expect(outcome.exitCode).toBe(1);
      expect(outcome.message).toContain('terminated by signal SIGTERM');
      expect(outcome.message).toContain('0-minute bound');
    });

    it('reports spawnSync\'s own ETIMEDOUT distinctly from a could-not-start failure', () => {
      const err = Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' });
      const outcome = describeSpawnResult({ error: err, status: null, signal: null }, 300);

      expect(outcome.exitCode).toBe(1);
      expect(outcome.message).toContain('did not finish');
      expect(outcome.message).toContain("wrapper's own");
      expect(outcome.message).not.toContain('could not start');
    });

    it('propagates a normal exit code untouched, with no message', () => {
      expect(describeSpawnResult({ error: null, status: 0, signal: null })).toEqual({
        exitCode: 0,
        message: null,
      });
      expect(describeSpawnResult({ error: null, status: 7, signal: null })).toEqual({
        exitCode: 7,
        message: null,
      });
    });
  });
});
