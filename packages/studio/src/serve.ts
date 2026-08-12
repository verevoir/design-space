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
 * The path is fixed. Tests drive `serveDocument(path)` directly rather than the container
 * accepting a path from its environment.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';

import type { GapRecord } from '@design-space/render';
import { startServer } from './server.js';
import { gapsPathFor } from './prerender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The document the container serves. Fixed, not configurable: an environment variable naming
 * the file to read and `JSON.parse` would let anyone who can set env on the container choose
 * both. Tests parameterise `serveDocument` instead — the composition is the testable seam, the
 * entry point is not.
 */
const DOCUMENT_PATH = join(__dirname, 'document.html');

/**
 * Read a pre-rendered document and its gaps sidecar, and serve them.
 *
 * Exported so tests can drive the real thing against a real path without the production entry
 * point having to accept one from outside.
 */
export async function serveDocument(documentPath: string): Promise<Server> {
  const gapsPath = gapsPathFor(documentPath);

  const html = await readFile(documentPath, 'utf-8').catch((err: NodeJS.ErrnoException) => {
    throw new Error(
      `Studio server failed to read the pre-rendered document at ${documentPath}: ${err.message}. ` +
        'Run the prerender build step before starting the server.',
      { cause: err },
    );
  });

  // The gaps sidecar is carried so the server HAS the data; no response surfaces it yet
  // (`handleRequest` reads only `rendered.html`). So an unreadable sidecar must not stop a
  // perfectly good document being served — refusing to start over data nothing reads would
  // trade real availability for none. It is reported on stderr instead, because a build that
  // writes an unparseable sidecar is still a defect worth seeing.
  //
  // Revisit when the server actually surfaces gaps: at that point serving an empty list WOULD
  // hide a finding, and failing loudly becomes the right call.
  const gaps: readonly GapRecord[] = await readFile(gapsPath, 'utf-8')
    .then((raw) => JSON.parse(raw) as GapRecord[])
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        process.stderr.write(
          `Studio server could not read the gaps sidecar at ${gapsPath}: ${err.message}. ` +
            'Serving the document with an empty gap list.\n',
        );
      }
      return [];
    });

  const server = await startServer({ rendered: { html, gaps } });
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : '?';
  process.stdout.write(`Studio server listening on port ${port}\n`);
  return server;
}

/**
 * The entry point's behaviour: serve the document, and on failure report it legibly and exit
 * non-zero so a container that cannot serve does not sit there pretending to.
 *
 * Exported so its three paths can be driven directly. Tests used to get at this by importing the
 * module for its side effect, which meant an import started a server.
 */
export async function runEntryPoint(documentPath: string): Promise<Server | undefined> {
  try {
    return await serveDocument(documentPath);
  } catch (err: unknown) {
    // Set the exit code rather than calling process.exit(). When stderr is a pipe — which is
    // exactly how a container's logs are collected — process.exit() can truncate a write that
    // has not flushed, losing the only explanation of why startup failed. Nothing keeps the
    // loop alive once startup has failed, so the process ends on its own after the write
    // drains, with the same non-zero status.
    process.exitCode = 1;
    process.stderr.write(
      `Studio server startup failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  }
}

/**
 * Resolves to the running server when this module is the process entry point and startup
 * succeeded, and to `undefined` otherwise — including when the module is merely imported,
 * which must not start anything. Tests drive `runEntryPoint` directly rather than awaiting this.
 */
/**
 * Only start when this module IS the process entry point. Importing it — which tests do, to
 * reach `serveDocument` — must not bind a port or read the baked-in document, or an import
 * becomes a side effect and a test run inherits a server nobody asked for.
 */
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

export const ready: Promise<Server | undefined> = isEntryPoint
  ? runEntryPoint(DOCUMENT_PATH)
  : Promise.resolve(undefined);
