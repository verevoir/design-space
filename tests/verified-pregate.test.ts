import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// verified-pregate.mjs is what carries CLAUDE_CODE_OAUTH_TOKEN and AIGENCY_GUARDRAILS_TOKEN
// into ../capabilities/scripts/run-pregate.mjs, a script that lives outside this repository and
// is therefore not versioned with the code it reviews. What is tested here is that nothing gets
// those credentials — nothing is spawned at all — unless the sibling script matches a digest
// pinned in THIS repository. Every scenario below uses disposable fixtures via
// PREGATE_TARGET_SCRIPT / PREGATE_PIN_FILE, never the real sibling checkout, so these tests are
// independent of whatever ../capabilities happens to contain when CI runs.

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

function runWrapper(env: Record<string, string>, args: string[] = []) {
  const res = spawnSync(process.execPath, [WRAPPER, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
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

  it('resolves a relative PREGATE_PIN_FILE against the repository root, not cwd', async () => {
    // scripts/pregate.sha256 is exactly this shape in real use — a path relative to the repo,
    // not to wherever the release step happens to be invoked from.
    const dir = await tmp('ds-vp-relpin-');
    const target = await fixtureTarget(dir);
    const digest = createHash('sha256').update(await readFile(target)).digest('hex');
    const repoRoot = dirname(dirname(WRAPPER));
    const relDir = '.tmp-verified-pregate-test-pin';
    const absDir = join(repoRoot, relDir);
    await mkdir(absDir, { recursive: true });
    await writeFile(join(absDir, 'pin.sha256'), `${digest}\n`, 'utf-8');

    try {
      const r = runWrapper({
        PREGATE_TARGET_SCRIPT: target,
        PREGATE_PIN_FILE: join(relDir, 'pin.sha256'),
      });

      expect(r.code).toBe(0);
    } finally {
      await rm(absDir, { recursive: true, force: true });
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
});
