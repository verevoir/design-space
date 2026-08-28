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
 *
 * The document is re-read from disk on EVERY request, not once at startup. A running server
 * used to close over the HTML string it read at boot, so a rebuild that wrote a new
 * document.html to the same running container was invisible until the process restarted —
 * a stale page served with no signal that it was stale, observed directly rather than
 * theorised. `startServer`'s `getRendered` is a provider function for exactly this: serve.ts
 * supplies one that reads the file fresh on every call (`readRenderedDocument` below); the
 * server itself has no opinion on whether the answer it gets is cached or live. This is a
 * deliberate deployed-behaviour change — Cloud Run now does a small static file read per
 * request instead of one at container boot — judged worth it for the iteration loop.
 *
 * Every read in this file — the per-request document read, the startup probe read, and the
 * gaps-sidecar read — is bounded by `DOCUMENT_READ_TIMEOUT_MS` (see below `readRenderedDocument`).
 * Before this bound existed, a stalled disk turned a per-request read into a request held open
 * indefinitely — the resilience-lens finding this fixes, against this file's own introduction
 * of per-request I/O. The startup and sidecar reads carry the identical unbounded-`fs.readFile`
 * shape and are bounded for the same reason, even though in practice a startup hang would
 * eventually be caught by Cloud Run's own deploy health check rather than by this process.
 *
 * All three reads also take `signal` as a PARAMETER rather than each constructing its own
 * `AbortSignal.timeout()` internally. The first pass at this fix only did that for the
 * per-request read (`readRenderedDocument`), which left the startup probe's and the sidecar's
 * own `AbortError` branches unreachable by any test — a real review finding, not a hypothetical
 * one: the reviewer named the exact regression it left uncaught — `describeReadFailure`'s
 * `err.name === 'AbortError'` check silently reverting to `err.code` (which an `AbortError`
 * does not set) would have passed every existing test while quietly breaking the diagnostic
 * message. `probeDocumentReadable` and `readGapsSidecar` below now take the identical shape,
 * and `serve-read-timeout.test.ts` drives all three the same way.
 *
 * The gaps sidecar is still read once, at startup, and is not part of this per-request
 * freshness: nothing in the response surfaces gaps today (see the comment on `gaps` below),
 * so there is nothing yet for a stale sidecar to make visibly wrong.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';

import type { GapRecord, RenderResult } from '@design-space/render';
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
 * Same-container local disk read of a small pre-rendered HTML document — not a network call.
 * 5 seconds is three orders of magnitude beyond what a healthy read of a file this size should
 * ever take (page cache makes a repeat read near-instant), while still failing within a
 * request-serving timeframe rather than holding a connection open forever if the disk stalls.
 */
export const DOCUMENT_READ_TIMEOUT_MS = 5_000;

/**
 * Turn a disk-read failure into a message that distinguishes a timeout from any other cause —
 * ENOENT, EACCES, corruption, whatever else `fs.readFile` can reject with.
 *
 * Checked against `'AbortError'`, not `'TimeoutError'` — confirmed by running
 * `serve-read-timeout.test.ts` rather than assumed from the `AbortSignal.timeout()` docs
 * alone: `fs.promises.readFile` does not propagate the aborting signal's own `reason` through
 * to its rejection. Passing a signal whose `reason` was an explicit `TimeoutError` DOMException
 * still surfaced here as Node's own generic `AbortError` ('The operation was aborted.') — so
 * that is what every abort of this read looks like, regardless of what fired it or what reason
 * it carried. Without this check, an operator would see only that generic, unattributed
 * message and be unable to tell a stalled disk from any other fs failure.
 */
function describeReadFailure(err: NodeJS.ErrnoException): string {
  return err.name === 'AbortError'
    ? `timed out after ${DOCUMENT_READ_TIMEOUT_MS}ms — the disk read did not complete`
    : err.message;
}

/**
 * Read the document fresh off disk for a single request, wrapping a read failure in the same
 * legible shape `serveDocument`'s startup check uses — named path, underlying message — so
 * whichever one fires (startup or a later request) reads the same way in a log.
 *
 * This deliberately races a rebuild — that is the point of reading fresh per request — but it
 * never observes a torn file. prerender.ts writes the document (and its gaps sidecar) via
 * `writeAtomically`: to a temp file first, then `rename()`d into place, and a rename within one
 * filesystem is atomic at the OS level. So this read always sees either the complete previous
 * document or the complete new one, never a partial write caught mid-flight. No content-shape
 * check is added here for that reason: it would be detecting corruption after the fact, where
 * the write-side fix instead makes the corruption impossible to produce in the first place.
 *
 * The gaps sidecar is deliberately NOT re-read here: it is captured once by `serveDocument`
 * and passed in, since nothing in the response surfaces it yet (see the comment there). Only
 * `html` needs to be live.
 *
 * `signal` is a parameter rather than this function constructing `AbortSignal.timeout()`
 * itself, so `serve-read-timeout.test.ts` can drive the real read against a real, controlled
 * signal — see that file's header for why.
 */
export async function readRenderedDocument(
  documentPath: string,
  gaps: readonly GapRecord[],
  signal: AbortSignal,
): Promise<RenderResult> {
  const html = await readFile(documentPath, { encoding: 'utf-8', signal }).catch(
    (err: NodeJS.ErrnoException) => {
      throw new Error(
        `Studio server could not read the pre-rendered document at ${documentPath} for this request: ${describeReadFailure(err)}.`,
        { cause: err },
      );
    },
  );
  return { html, gaps };
}

/**
 * A startup probe, not what gets served: confirms the document is readable NOW, so a container
 * that can never serve fails fast and loudly at boot rather than starting and answering every
 * request with a 503. What actually reaches a response is read again, fresh, by
 * `readRenderedDocument` on each request — this function's result is deliberately discarded by
 * its caller.
 *
 * `signal` is a parameter for the same reason as `readRenderedDocument`'s: so
 * `serve-read-timeout.test.ts` can drive the real read against a real, controlled
 * already-aborted signal, rather than only exercising the ENOENT path this catch block already
 * handled. `serveDocument` supplies `AbortSignal.timeout(DOCUMENT_READ_TIMEOUT_MS)`.
 */
export async function probeDocumentReadable(documentPath: string, signal: AbortSignal): Promise<void> {
  await readFile(documentPath, { encoding: 'utf-8', signal }).catch(
    (err: NodeJS.ErrnoException) => {
      throw new Error(
        `Studio server failed to read the pre-rendered document at ${documentPath}: ${describeReadFailure(err)}. ` +
          'Run the prerender build step before starting the server.',
        { cause: err },
      );
    },
  );
}

/**
 * Read the gaps sidecar once, at startup. The gaps sidecar is carried so the server HAS the
 * data; no response surfaces it yet (`handleRequest` reads only `rendered.html`). So an
 * unreadable sidecar must not stop a perfectly good document being served — refusing to start
 * over data nothing reads would trade real availability for none. It is reported on stderr
 * instead, because a build that writes an unparseable sidecar is still a defect worth seeing.
 *
 * Revisit when the server actually surfaces gaps: at that point serving an empty list WOULD
 * hide a finding, and failing loudly becomes the right call. At that same point, re-read this
 * per request too, the way `html` now is.
 *
 * `signal` is a parameter for the same reason as `readRenderedDocument`'s and
 * `probeDocumentReadable`'s: so a test can drive this against a real, controlled
 * already-aborted signal and observe the diagnostic on stderr, rather than only exercising the
 * ENOENT and JSON.parse-failure paths this catch block already handled.
 */
export async function readGapsSidecar(
  gapsPath: string,
  signal: AbortSignal,
): Promise<readonly GapRecord[]> {
  return readFile(gapsPath, { encoding: 'utf-8', signal })
    .then((raw) => JSON.parse(raw) as GapRecord[])
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        process.stderr.write(
          `Studio server could not read the gaps sidecar at ${gapsPath}: ${describeReadFailure(err)}. ` +
            'Serving the document with an empty gap list.\n',
        );
      }
      return [];
    });
}

/**
 * Read a pre-rendered document and its gaps sidecar, and serve them — the document freshly on
 * every request, the gaps sidecar once (see `readRenderedDocument`).
 *
 * Exported so tests can drive the real thing against a real path without the production entry
 * point having to accept one from outside.
 */
export async function serveDocument(documentPath: string): Promise<Server> {
  const gapsPath = gapsPathFor(documentPath);

  await probeDocumentReadable(documentPath, AbortSignal.timeout(DOCUMENT_READ_TIMEOUT_MS));

  const gaps: readonly GapRecord[] = await readGapsSidecar(
    gapsPath,
    AbortSignal.timeout(DOCUMENT_READ_TIMEOUT_MS),
  );

  const server = await startServer({
    getRendered: () =>
      readRenderedDocument(documentPath, gaps, AbortSignal.timeout(DOCUMENT_READ_TIMEOUT_MS)),
  });
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
 * Only start when this module IS the process entry point. Importing it — which tests do, to
 * reach `serveDocument` — must not bind a port or read the baked-in document, or an import
 * becomes a side effect and a test run inherits a server nobody asked for.
 */
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

/**
 * Resolves to the running server when this module is the process entry point and startup
 * succeeded, and to `undefined` otherwise — including when the module is merely imported,
 * which must not start anything. Tests drive `runEntryPoint` directly rather than awaiting this.
 */
export const ready: Promise<Server | undefined> = isEntryPoint
  ? runEntryPoint(DOCUMENT_PATH)
  : Promise.resolve(undefined);
