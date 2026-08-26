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
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

    it('reports zero gaps for the reference journey — every port component now has a sketch renderer (story 3.1)', async () => {
      const repoRoot = resolve(dirname(scriptPath), '../../..');
      const { code, stdout } = await runScript(repoRoot);

      // Until story 3.1, only `prompt` was implemented, so this same build reported five gaps
      // (compare-set, input-set, status, option-list, summary) against the real broadband-switch
      // journey. The sketch adapter now implements every port component, and the real journey's
      // block props all validate against the induced schemas, so the build's own gaps branch
      // (`if (gaps.length > 0)`) must not fire at all — inverted from the prior assertion rather
      // than deleted, since the old premise ("the reference journey must report gaps") is exactly
      // what this story sets out to make false.
      expect(code).toBe(0);
      expect(stdout).toContain('Prerender complete.');
      expect(stdout).not.toContain('gaps (unimplemented components):');
    });
  });
});


const HTML = '<!doctype html><html><body><h1>entry point document</h1></body></html>';

/** Ask the OS for a free port by binding :0 and reading it back. */
async function findFreePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((res, rej) => {
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => res());
  });
  const addr = srv.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  await new Promise<void>((res) => srv.close(() => res()));
  return port;
}

describe('serve.ts as the process entry point', () => {
  let entryDir: string;

  beforeEach(async () => {
    entryDir = join(tmpdir(), `ds-entry-${process.pid}-${Math.abs(Number(process.hrtime.bigint() % 100000n))}`);
    await rm(entryDir, { recursive: true, force: true });
    await mkdir(entryDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(entryDir, { recursive: true, force: true });
  });

  it('starts and announces its port when run as the entry point, the way the container runs it', async () => {
    // The Dockerfile's CMD is `node packages/studio/dist/serve.js`. That path — module as
    // process entry point — is the one line of production behaviour the rest of the suite
    // cannot reach, because every other test imports the module instead of running it.
    // So it is spawned here exactly as the container spawns it.
    const { execFile } = await import('node:child_process');
    const serveJs = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/serve.js');
    const docPath = resolve(dirname(serveJs), 'document.html');
    const hadDocument = await readFile(docPath, 'utf-8').then(
      () => true,
      () => false,
    );
    if (!hadDocument) await writeFile(docPath, HTML, 'utf-8');

    const port = await findFreePort();
    const child = execFile('node', [serveJs], {
      env: { ...process.env, PORT: String(port) },
    });

    try {
      const line = await new Promise<string>((res, rej) => {
        const timer = setTimeout(() => rej(new Error('entry point did not announce a port')), 15_000);
        child.stdout?.on('data', (d: Buffer | string) => {
          const text = String(d);
          if (text.includes('listening on port')) {
            clearTimeout(timer);
            res(text);
          }
        });
        child.on('error', (e) => {
          clearTimeout(timer);
          rej(e);
        });
      });

      expect(line).toContain(`listening on port ${port}`);
    } finally {
      child.kill();
      if (!hadDocument) await rm(docPath, { force: true });
    }
  });

  describe('no-gaps branch: a journey using only implemented components', () => {
    let cleanRepo: string;

    beforeAll(async () => {
      // Every block here is `prompt`, the one component the sketch adapter implements, so the
      // render reports no gaps and the `if (gaps.length > 0)` branch must NOT fire. Without
      // this, only the true side of that branch was ever exercised.
      cleanRepo = await mkdtemp(join(tmpdir(), 'ds-prerender-nogaps-'));
      const git = (...args: string[]) => execFileAsync('git', args, { cwd: cleanRepo });
      await git('init', '-q');
      await git('config', 'user.email', 'test@example.invalid');
      await git('config', 'user.name', 'Test');
      await git('config', 'commit.gpgsign', 'false');

      await mkdir(join(cleanRepo, 'examples', 'journeys'), { recursive: true });
      await writeFile(
        join(cleanRepo, 'examples', 'journeys', 'broadband-switch.json'),
        JSON.stringify({
          id: 'broadband-switch',
          title: 'Only implemented components',
          intent: 'Exercise the no-gaps path of the build step.',
          entry: 'only',
          screens: [
            {
              id: 'only',
              purpose: 'A screen the adapter can render completely.',
              blocks: [{ component: 'prompt', props: { heading: 'All implemented' } }],
              actions: [{ label: 'Done', weight: 'primary', target: null }],
              annotations: [],
            },
          ],
        }),
        'utf-8',
      );
      await git('add', '-A');
      await git('commit', '-qm', 'a journey with nothing missing');
    });

    afterAll(async () => {
      if (cleanRepo) await rm(cleanRepo, { recursive: true, force: true });
    });

    it('completes without reporting gaps when nothing is missing', async () => {
      const { code, stdout } = await runScript(cleanRepo);

      expect(code).toBe(0);
      expect(stdout).toContain('Prerender complete.');
      expect(stdout).not.toContain('gaps (unimplemented components):');
    });
  });
});
