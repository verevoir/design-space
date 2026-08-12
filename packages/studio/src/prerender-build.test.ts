/**
 * `scripts/prerender-build.mjs` is the build-time launcher the Dockerfile runs. It is production
 * code with two deliberate branches — a gaps-reporting branch and a failure branch that exits 1 —
 * and neither was executed by any test.
 *
 * It is driven here as a child process, through its real interface, because that is how the
 * container invokes it. Importing its internals would test a different thing from the one that
 * runs, and the failure worth catching is "the build step does not fail the build when the
 * prerender fails".
 */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../scripts/prerender-build.mjs',
);

/** Run the script against a repo path, capturing stdout, stderr and the exit code. */
async function runScript(
  repoPath: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [scriptPath, repoPath], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('prerender-build.mjs — the build step the container runs', () => {
  describe('failure branch', () => {
    let emptyDir: string;

    beforeAll(async () => {
      emptyDir = await mkdtemp(join(tmpdir(), 'ds-prerender-build-empty-'));
    });

    afterAll(async () => {
      if (emptyDir) await rm(emptyDir, { recursive: true, force: true });
    });

    it('exits non-zero when the prerender fails, so a broken build cannot ship', async () => {
      const { code } = await runScript(emptyDir);

      // The whole point of the catch branch: a prerender failure must fail the docker build.
      // If this exits 0, the image would be built with a stale or absent document.
      expect(code).not.toBe(0);
    });

    it('writes the failure to stderr naming what went wrong', async () => {
      const { stderr } = await runScript(emptyDir);

      expect(stderr).toContain('Prerender failed:');
    });
  });

  describe('success branch, against this repository', () => {
    let outDir: string;

    beforeAll(async () => {
      // The script writes to packages/studio/dist/document.html relative to itself, so the
      // success run exercises the real output path rather than a redirected one.
      outDir = join(dirname(scriptPath), '../dist');
      await mkdir(outDir, { recursive: true });
    });

    it('reports the unimplemented components as gaps rather than passing silently', async () => {
      const repoRoot = resolve(dirname(scriptPath), '../../..');
      const { code, stdout } = await runScript(repoRoot);

      expect(code).toBe(0);
      // Only `prompt` is implemented in wave 2S, so the reference journey must report gaps.
      // A silent success here would mean the gaps branch never fires and nobody learns which
      // components are missing at build time.
      expect(stdout).toContain('gaps (unimplemented components):');
      expect(stdout).toContain('compare-set');
    });
  });
});
