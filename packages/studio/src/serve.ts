/**
 * Runtime entry point for the studio container.
 *
 * Reads the pre-rendered HTML document from disk (written by the build-time
 * prerender step) and serves it via startServer. No rendering happens here —
 * the document was produced at build time and baked into the image. See
 * prerender.ts for why: the store reads via `git show`, which needs a git
 * repository. The runtime image carries neither the repo nor git.
 *
 * The document path is resolved relative to this file's location, which
 * is dist/serve.js at runtime — so the path is dist/document.html, written
 * there by the build-time prerender step.
 *
 * DOCUMENT_PATH_OVERRIDE env var replaces the default path — used only in
 * integration tests that need to supply a known document without writing into
 * the dist/ directory.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

import type { GapRecord } from '@design-space/render';
import { startServer } from './server.js';
import { gapsPathFor } from './prerender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCUMENT_PATH =
  process.env['DOCUMENT_PATH_OVERRIDE'] ?? join(__dirname, 'document.html');
const GAPS_PATH = gapsPathFor(DOCUMENT_PATH);

async function main(): Promise<Server> {
  const html = await readFile(DOCUMENT_PATH, 'utf-8').catch((err: NodeJS.ErrnoException) => {
    throw new Error(
      `Studio server failed to read the pre-rendered document at ${DOCUMENT_PATH}: ${err.message}. ` +
        'Run the prerender build step before starting the server.',
      { cause: err },
    );
  });

  // Read the gaps sidecar written by the build-time prerender step. If it is absent (e.g.
  // the prerender was run without the sidecar, as in older builds), fall back to an empty
  // list rather than failing — the HTML document is still serveable.
  const gaps: readonly GapRecord[] = await readFile(GAPS_PATH, 'utf-8')
    .then((raw) => JSON.parse(raw) as GapRecord[])
    .catch(() => []);

  const server = await startServer({ rendered: { html, gaps } });
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : '?';
  process.stdout.write(`Studio server listening on port ${port}\n`);
  return server;
}

/**
 * Resolves to the running server when main() completes successfully, or to
 * `undefined` after the catch handler runs (startup failed). Tests can await
 * this promise instead of sleeping on a timer, giving a deterministic signal
 * that all module-level async work has settled.
 */
export const ready: Promise<Server | undefined> = main().catch((err: unknown) => {
  process.stderr.write(
    `Studio server startup failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
  return undefined;
});
