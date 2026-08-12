import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { PORT_VERSION } from '@design-space/port';
import type { RenderResult } from '@design-space/render';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A pre-rendered result that the server will serve at /.
 * Accepting the render output rather than re-rendering per-request keeps the
 * server minimal and avoids coupling it to the adapter-sketch package.
 */
export interface ServerOptions {
  /** The pre-rendered broadband-switch HTML. */
  readonly rendered: RenderResult;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rendered: RenderResult,
): void {
  const url = req.url ?? '/';

  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', portVersion: PORT_VERSION }));
    return;
  }

  if (url === '/') {
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
  const { rendered } = options;
  return createServer((req, res) => handleRequest(req, res, rendered));
}

/**
 * Start the studio server.
 *
 * Reads PORT from the environment (default 8080) and binds to 0.0.0.0.
 * Returns a promise that resolves to the listening server, or rejects with a
 * legible error if the port is unavailable (EADDRINUSE) or binding otherwise
 * fails.
 *
 * After the server is listening, any subsequent runtime socket errors are
 * forwarded to stderr rather than being silently swallowed. The one-shot
 * startup listener is detached once the promise settles so it cannot intercept
 * a post-startup error and call `reject` on an already-settled promise.
 */
export function startServer(options: ServerOptions): Promise<Server> {
  const port = Number(process.env['PORT'] ?? 8080);
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
