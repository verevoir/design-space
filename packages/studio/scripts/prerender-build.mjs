/**
 * Build-time prerender launcher (plain ESM, no TypeScript).
 *
 * Imports from the compiled dist/ output produced by `tsc -b` and runs
 * prerender against this repository at HEAD, writing the result to
 * dist/document.html — the path serve.js reads at runtime.
 *
 * Run this after `npm run build`:
 *
 *   node packages/studio/scripts/prerender-build.mjs [repoPath]
 *
 * repoPath defaults to the repository root (resolved relative to this file).
 * PRERENDER_REF env var overrides the git ref (default: HEAD).
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const repoPath = process.argv[2] ?? repoRoot;
const outPath = join(__dirname, '../dist/document.html');
const ref = process.env['PRERENDER_REF'] ?? 'HEAD';

// Import from the compiled dist — built by `tsc -b` before this script runs.
const { prerender } = await import('../dist/prerender.js');

process.stdout.write(
  `Prerendering broadband-switch at ref=${ref} from ${repoPath} → ${outPath}\n`,
);

prerender({
  repoPath,
  journeyId: 'broadband-switch',
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
