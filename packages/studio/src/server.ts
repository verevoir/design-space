import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { PORT_VERSION } from '@design-space/port';
import type { RenderResult } from '@design-space/render';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How the server gets the pre-rendered result it serves at /.
 *
 * This is a PROVIDER, not a value: the server calls it once per request, live, rather than
 * closing over a value fixed at server-creation time. The server itself stays ignorant of
 * whether the answer is cached (fixed for the process's whole life — most tests still just
 * want this, via a function that always resolves to the same value) or freshly produced on
 * every call (what serve.ts does in production, so a rebuilt document is visible to a running
 * server without a restart). That decision belongs entirely to the caller wiring this up.
 *
 * Rejecting is a legitimate answer, not just a value being unavailable: the server treats a
 * rejected call as "cannot serve this request" and answers 503 rather than crashing — see
 * `handleRequest`.
 */
export interface ServerOptions {
  readonly getRendered: () => Promise<RenderResult>;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  getRendered: () => Promise<RenderResult>,
): Promise<void> {
  const url = req.url ?? '/';

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Why `revision` exists and what it distinguishes: docs/architecture.md §9a ("`/health`
    // says which build answered").
    //
    // Explicitly null off Cloud Run rather than omitted: a missing field is ambiguous between
    // "not running on Cloud Run" and "running on a build too old to report it", and the second
    // is the case a caller must not silently accept.
    //
    // Neither field here depends on `getRendered` — portVersion is a package constant and
    // revision comes from the container's own K_REVISION env var — so this endpoint is
    // unaffected by whether the caller's provider is cached or reads fresh per call.
    res.end(
      JSON.stringify({
        status: 'ok',
        portVersion: PORT_VERSION,
        revision: process.env['K_REVISION'] ?? null,
      }),
    );
    return;
  }

  if (url === '/') {
    let rendered: RenderResult;
    try {
      rendered = await getRendered();
    } catch (err) {
      // The provider failed for this request — e.g. serve.ts's file-backed provider found the
      // document missing or unreadable. That must not crash the process (an unhandled
      // rejection here would take the whole server down, not just this request), so it is
      // reported to stderr — the container log is where an operator would look — and answered
      // as 503: "this instance cannot serve right now", which is honest and lets a caller retry
      // or a monitor page on it, rather than a 200 with an empty or wrong body.
      process.stderr.write(
        `Studio server: the document provider failed for a request: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service temporarily unavailable');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(rendered.html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an HTTP server that serves the pre-rendered journey document.
 *
 * The server is returned but NOT started — call `.listen()` yourself. This
 * keeps the module importable in tests without binding a port.
 */
export function createStudioServer(options: ServerOptions): Server {
  const { getRendered } = options;
  return createServer((req, res) => {
    // handleRequest's own try/catch answers a rejected provider with a 503 rather than
    // throwing, so this is not swallowing an error silently — it exists only because
    // node:http's request callback is not awaited by the framework, and an unawaited async
    // function call must still not become an unhandled rejection.
    void handleRequest(req, res, getRendered);
  });
}

/**
 * Start the studio server.
 *
 * Reads PORT from the environment (default 8080) and binds to 0.0.0.0.
 * Returns a promise that resolves to the listening server, or rejects with a
 * legible error if:
 *   - PORT is set to a non-integer or out-of-range value (0–65535) — rejected
 *     immediately so a misconfigured container fails loudly at startup rather
 *     than silently binding to an unexpected port.
 *   - The port is unavailable (EADDRINUSE) or binding otherwise fails.
 *
 * PORT=0 is accepted deliberately: it is the standard convention (shared with
 * `net.Server.listen`) for "let the OS assign a free ephemeral port", not a
 * malformed value. Nothing production sets it — Cloud Run always supplies an
 * explicit PORT — but tests that start a real server need a way to ask for a
 * free port without racing a separate probe-and-rebind step against whatever
 * else is listening on the machine. Call `.address()` on the resolved server
 * to read back which port was actually bound.
 *
 * After the server is listening, any subsequent runtime socket errors are
 * forwarded to stderr rather than being silently swallowed. The one-shot
 * startup listener is detached once the promise settles so it cannot intercept
 * a post-startup error and call `reject` on an already-settled promise.
 */
export function startServer(options: ServerOptions): Promise<Server> {
  const rawPort = process.env['PORT'];
  // undefined (never set) and '' or whitespace-only (set but blank — the ordinary shape of a
  // container misconfiguration: an unresolved template variable, an empty env override) are
  // different failures and must not collapse to the same outcome. Number('') === 0, so without
  // this distinction a blank PORT would silently pass as the literal '0' ephemeral-port
  // convention below instead of hitting the invalid-PORT rejection it should. Only an actual
  // '0' means the convention; a blank string forces NaN so it falls through to the same
  // rejection as any other malformed value, with rawPort (not the coerced port) still shown so
  // the operator can see exactly what was set.
  const port =
    rawPort === undefined ? 8080 : rawPort.trim() === '' ? NaN : Number(rawPort);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(
      new Error(
        `Studio server failed to start: PORT is invalid (${JSON.stringify(rawPort)}) — must be an integer between 0 and 65535`,
      ),
    );
  }

  const server = createStudioServer(options);
  return new Promise((resolve, reject) => {
    function onStartupError(err: NodeJS.ErrnoException) {
      const detail = err.code === 'EADDRINUSE'
        ? `port ${port} is already in use`
        : err.message;
      reject(new Error(`Studio server failed to start: ${detail}`, { cause: err }));
    }
    server.once('error', onStartupError);
    server.listen(port, '0.0.0.0', () => {
      // Detach the startup handler before resolving — a post-startup socket
      // error must not silently call reject on the already-settled promise.
      server.off('error', onStartupError);
      server.on('error', (err: Error) => {
        process.stderr.write(`Studio server runtime error: ${err.message}\n`);
      });
      resolve(server);
    });
  });
}
