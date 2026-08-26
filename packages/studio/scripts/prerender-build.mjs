/**
 * Build-time prerender launcher (plain ESM, no TypeScript).
 *
 * Imports from the compiled dist/ output produced by `tsc -b` and runs
 * prerender against this repository at HEAD, writing the result to
 * dist/document.html — the path serve.js reads at runtime.
 *
 * Run this after `npm run build`:
 *
 *   node packages/studio/scripts/prerender-build.mjs [repoPath] [outPath] [journeyId]
 *
 * repoPath defaults to the repository root (resolved relative to this file).
 * outPath defaults to dist/document.html next to this script — the real path serve.js reads —
 * and is a second POSITIONAL argument, matching repoPath, rather than an env var: both name
 * where this run reads from and writes to, so a caller that wants either non-default says so
 * the same way. This closes a real defect: before this argument existed, a caller that pointed
 * repoPath at a scratch repository still wrote its output to the real dist/document.html,
 * because outPath was computed relative to the SCRIPT's own location rather than passed in — a
 * test built a proper throwaway git repo for its input and still corrupted the real, served
 * build artifact as a side effect of running.
 * journeyId defaults to 'broadband-switch' — the declared `prerender` command in aigency.json
 * invokes this script with zero arguments, so that default is what production actually builds
 * and must not change. It is a third POSITIONAL argument for the same reason outPath is one
 * rather than an env var: it names WHICH journey this run reads, the same kind of fact repoPath
 * and outPath already name about where. This closes a real gap: the id was previously a literal
 * inside this file, so `examples/journeys/broadband-switch.postcode-first.json` — the second
 * reference journey, addressed by the store as id 'broadband-switch.postcode-first' (the store
 * resolves an object by (kind, id) to `journeys/<id>.json`, ADR 0002; the postcode-first file's
 * OWN internal "id" field is, confusingly, also "broadband-switch" — that field is journey
 * content, not the store address, and this script was never able to reach it by any id at all).
 * PRERENDER_REF env var overrides the git ref (default: HEAD).
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const repoPath = process.argv[2] ?? repoRoot;
const outPath = process.argv[3] ?? join(__dirname, '../dist/document.html');
const journeyId = process.argv[4] ?? 'broadband-switch';
const ref = process.env['PRERENDER_REF'] ?? 'HEAD';

// Import from the compiled dist — built by `tsc -b` before this script runs.
const { prerender } = await import('../dist/prerender.js');

process.stdout.write(
  `Prerendering ${journeyId} at ref=${ref} from ${repoPath} → ${outPath}\n`,
);

prerender({
  repoPath,
  journeyId,
  ref,
  root: 'examples',
  outPath,
})
  .then(({ gaps }) => {
    if (gaps.length > 0) {
      process.stdout.write(
        `  gaps (unimplemented components): ${gaps.join(', ')}\n`,
      );
    }
    process.stdout.write('Prerender complete.\n');
  })
  .catch((err) => {
    // exitCode, not exit(): process.exit() can truncate an unflushed stderr write when stderr
    // is a pipe, which is how a docker build captures it — losing the reason the build failed.
    process.exitCode = 1;
    process.stderr.write(
      `Prerender failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });
