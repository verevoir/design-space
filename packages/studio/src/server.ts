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
 * Returns the listening server so callers can close it.
 */
export function startServer(options: ServerOptions): Server {
  const port = Number(process.env['PORT'] ?? 8080);
  const server = createStudioServer(options);
  server.listen(port, '0.0.0.0');
  return server;
}
