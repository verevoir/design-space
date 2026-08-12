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
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCUMENT_PATH = join(__dirname, 'document.html');

async function main(): Promise<void> {
  const html = await readFile(DOCUMENT_PATH, 'utf-8').catch((err: NodeJS.ErrnoException) => {
    throw new Error(
      `Studio server failed to read the pre-rendered document at ${DOCUMENT_PATH}: ${err.message}. ` +
        'Run the prerender build step before starting the server.',
      { cause: err },
    );
  });

  const server = await startServer({ rendered: { html, gaps: [] } });
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : '?';
  process.stdout.write(`Studio server listening on port ${port}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Studio server startup failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
