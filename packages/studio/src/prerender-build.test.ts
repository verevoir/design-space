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

/**
 * Run the script against a repo path, capturing stdout, stderr and the exit code.
 *
 * `outPath`, when supplied, is passed as the script's second positional argument. Every call
 * below that writes real output now supplies one pointing at a scratch path — letting a test
 * fall back to the script's real default (packages/studio/dist/document.html) is exactly the
 * defect this file used to have and no longer should.
 *
 * `journeyId`, when supplied, is passed as the script's third positional argument. It cannot be
 * given without `outPath` also being given — there is no call site here that wants a
 * non-default journey written to the real dist/document.html, and the signature does not offer
 * that shape.
 */
async function runScript(
  repoPath: string,
  outPath?: string,
  journeyId?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const args = [scriptPath, repoPath];
    if (outPath !== undefined) args.push(outPath);
    if (journeyId !== undefined) args.push(journeyId);
    const { stdout, stderr } = await execFileAsync('node', args, {
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
      // The real repository is a legitimate INPUT here — it exercises the real broadband-switch
      // journey — but the OUTPUT goes to a scratch directory, not packages/studio/dist/. A test
      // that writes the real, served build artifact as a side effect of running is a defect
      // regardless of whether what it writes happens to be correct; see the no-gaps block below
      // for what happens when it is not (that was the actual incident this fix responds to).
      outDir = await mkdtemp(join(tmpdir(), 'ds-prerender-build-success-'));
    });

    afterAll(async () => {
      if (outDir) await rm(outDir, { recursive: true, force: true });
    });

    it('reports zero gaps for the reference journey — every port component now has a sketch renderer (story 3.1)', async () => {
      const repoRoot = resolve(dirname(scriptPath), '../../..');
      const { code, stdout } = await runScript(repoRoot, join(outDir, 'document.html'));

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

  describe('the default output path, exercised by actually running the script', () => {
    // The literal expression under test — `process.argv[3] ?? join(__dirname, '../dist/document.html')`
    // — can only be exercised by really running the script with no third argument, and doing that
    // at its real location would overwrite the real, served packages/studio/dist/document.html —
    // precisely the corruption this file's other blocks exist to stop. So the script, plus the
    // ONE compiled sibling it imports (`../dist/prerender.js`, a leaf module: it imports only
    // bare `@design-space/*` specifiers and node builtins, no further relative siblings), are
    // copied into a scratch directory placed inside this package — so Node's module resolution
    // still walks up to the workspace's real node_modules from the copy, the same way it does
    // from the real dist/. Running the copy with no third argument makes `__dirname` resolve
    // inside the scratch tree, so the real fallback computes a scratch path and writes there.
    // A prior version of this test asserted the fallback expression's literal spelling instead —
    // a refactor that reformatted it would have broken that test for no behavioural reason, and a
    // genuine regression in where the default resolves would have sailed through untouched. This
    // version fails on the second and passes through the first.
    let scratchRoot: string;

    beforeAll(async () => {
      const studioRoot = resolve(dirname(scriptPath), '..');
      scratchRoot = await mkdtemp(join(studioRoot, '.ds-prerender-default-'));
      await mkdir(join(scratchRoot, 'scripts'), { recursive: true });
      await mkdir(join(scratchRoot, 'dist'), { recursive: true });
      const scriptSource = await readFile(scriptPath, 'utf-8');
      await writeFile(join(scratchRoot, 'scripts', 'prerender-build.mjs'), scriptSource, 'utf-8');
      const compiledPrerender = await readFile(join(studioRoot, 'dist', 'prerender.js'), 'utf-8');
      await writeFile(join(scratchRoot, 'dist', 'prerender.js'), compiledPrerender, 'utf-8');
    });

    afterAll(async () => {
      if (scratchRoot) await rm(scratchRoot, { recursive: true, force: true });
    });

    it('defaults outPath to dist/document.html next to the script when no third argument is given', async () => {
      const repoRoot = resolve(dirname(scriptPath), '../../..');
      const scratchScript = join(scratchRoot, 'scripts', 'prerender-build.mjs');

      // Only repoPath is passed — no outPath — so the real fallback runs, against the copy's own
      // __dirname, exactly as it would for a real zero-argument invocation.
      const { code, stdout } = await execFileAsync('node', [scratchScript, repoRoot], {
        encoding: 'utf8',
        timeout: 60_000,
      }).then(
        (r) => ({ code: 0, stdout: r.stdout }),
        (err: { code?: number; stdout?: string }) => ({ code: err.code ?? 1, stdout: err.stdout ?? '' }),
      );

      expect(code).toBe(0);
      expect(stdout).toContain('Prerender complete.');

      // Checks where it actually wrote, not merely what the source names as the default.
      const written = await readFile(join(scratchRoot, 'dist', 'document.html'), 'utf-8');
      expect(written.length).toBeGreaterThan(0);
    });
  });

  describe('the default journey id, asserted without writing there', () => {
    it('defaults journeyId to broadband-switch when no fourth argument is given, so the declared prerender command is unaffected', async () => {
      // Same discipline as the outPath default above: actually exercising "no fourth argument"
      // by running the script with two arguments only would write the real broadband-switch
      // journey's rendered HTML into whatever outPath was given — fine in isolation, but the
      // point of THIS test is to confirm the DEFAULT specifically, and doing that by running the
      // script conflates "the default happens to be broadband-switch" with "I asked for
      // broadband-switch" (this file's other blocks already ask for it explicitly). Confirmed
      // instead by reading the script's own fallback expression, which is the actual source of
      // truth aigency.json's zero-argument `prerender` command depends on.
      const source = await readFile(scriptPath, 'utf-8');
      expect(source).toContain("process.argv[4] ?? 'broadband-switch'");
    });
  });

});


const HTML = '<!doctype html><html><body><h1>entry point document</h1></body></html>';

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

    // PORT=0 asks the OS to assign a free ephemeral port — no separate probe step naming a
    // number ahead of time, and so nothing for the container's own bind to race against.
    const child = execFile('node', [serveJs], {
      env: { ...process.env, PORT: '0' },
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

      // The port was never chosen ahead of time — it is read back out of the child's own
      // stdout, which is what actually announces the port the OS handed it.
      const announced = line.match(/listening on port (\d+)/);
      expect(announced).not.toBeNull();
      const port = Number(announced?.[1]);
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65535);

      // Confirm it is actually reachable on the announced port, not just that a number was
      // printed.
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
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
      // Output goes inside the same scratch repo, never the real dist/document.html — this is
      // the exact test that produced the fixture ("Only implemented components" / "All
      // implemented" / "Done") found being served in production. Passing outPath explicitly is
      // the fix; the script's default was never wrong for its own real invocation, only for a
      // caller like this one that redirected the input but not the output.
      const { code, stdout } = await runScript(cleanRepo, join(cleanRepo, 'document.html'));

      expect(code).toBe(0);
      expect(stdout).toContain('Prerender complete.');
      expect(stdout).not.toContain('gaps (unimplemented components):');
    });
  });
});
