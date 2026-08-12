import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createStudioServer, startServer } from './server.js';
import type { RenderResult } from '@design-space/render';
import { PORT_VERSION } from '@design-space/port';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRendered(html: string): RenderResult {
  return { html, gaps: [] };
}

/**
 * Bind the server to a random OS-assigned port and return the base URL.
 * Closes the server automatically via the afterEach registration.
 */
function bindServer(server: Server, teardown: (fn: () => void) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('unexpected address shape'));
        return;
      }
      teardown(() => server.close());
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createStudioServer()', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function register(fn: () => void) {
    cleanup = fn;
  }

  describe('/healthz endpoint', () => {
    it('returns HTTP 200', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/healthz`);
      expect(res.status).toBe(200);
    });

    it('returns JSON with status=ok', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/healthz`);
      const body = await res.json() as Record<string, unknown>;
      expect(body['status']).toBe('ok');
    });

    it('returns the port version in the response body', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/healthz`);
      const body = await res.json() as Record<string, unknown>;
      expect(body['portVersion']).toBe(PORT_VERSION);
    });
  });

  describe('/ endpoint', () => {
    it('returns HTTP 200', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html><body>hi</body></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/`);
      expect(res.status).toBe(200);
    });

    it('returns the rendered HTML body', async () => {
      const html = '<!DOCTYPE html><html><body><h1>Journey</h1></body></html>';
      const server = createStudioServer({ rendered: makeRendered(html) });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/`);
      const text = await res.text();
      expect(text).toBe(html);
    });

    it('Content-Type is text/html', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/`);
      expect(res.headers.get('content-type')).toContain('text/html');
    });
  });

  describe('unknown route', () => {
    it('returns HTTP 404 for an unrecognised path', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/not-a-real-path`);
      expect(res.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// startServer() — listen error path
//
// The critical behaviour: if the port is already in use, startServer() must
// reject with a legible Error rather than emitting an unhandled 'error' event
// on the server. This is verified by:
//   1. Binding a raw net server to a port so the OS reserves it.
//   2. Calling startServer() with PORT set to that same port.
//   3. Confirming the returned promise rejects and the message names the port.
// ---------------------------------------------------------------------------

describe('startServer()', () => {
  let blocker: Server | undefined;

  afterEach(async () => {
    if (blocker) {
      await new Promise<void>((res) => blocker!.close(() => res()));
      blocker = undefined;
    }
  });

  /**
   * Bind a plain HTTP server to a random port on 0.0.0.0 and return the port number.
   * The server stays open — it is the "port already in use" fixture.
   * Must bind 0.0.0.0 to match what startServer() binds, so the OS sees the port as taken.
   */
  function occupyPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(0, '0.0.0.0', () => {
        const addr = s.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('unexpected address shape'));
          return;
        }
        blocker = s;
        resolve(addr.port);
      });
    });
  }

  it('rejects with a legible error when the port is already in use (EADDRINUSE)', async () => {
    const port = await occupyPort();
    const origPort = process.env['PORT'];
    process.env['PORT'] = String(port);
    try {
      await expect(
        startServer({ rendered: makeRendered('<html></html>') }),
      ).rejects.toThrow(/already in use/);
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
  });

  it('error message from EADDRINUSE names the port number', async () => {
    const port = await occupyPort();
    const origPort = process.env['PORT'];
    process.env['PORT'] = String(port);
    let caughtMessage = '';
    try {
      await startServer({ rendered: makeRendered('<html></html>') });
    } catch (err) {
      caughtMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
    expect(caughtMessage).toContain(String(port));
  });

  // ---------------------------------------------------------------------------
  // Malformed PORT — rejects immediately rather than silently binding a random port
  //
  // When PORT is set to a non-integer or out-of-range value the server must
  // reject the returned promise with a legible error. This is a startup
  // invariant: a container with a misconfigured PORT env var must fail loudly so
  // the operator can see and fix it, rather than silently binding to port 0 or
  // some other unexpected port that works until someone looks.
  // ---------------------------------------------------------------------------

  it('rejects immediately when PORT is set to a non-numeric string', async () => {
    const origPort = process.env['PORT'];
    process.env['PORT'] = 'not-a-port';
    try {
      await expect(
        startServer({ rendered: makeRendered('<html></html>') }),
      ).rejects.toThrow(/PORT is invalid/);
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
  });

  it('error message for a malformed PORT includes the bad value', async () => {
    const origPort = process.env['PORT'];
    process.env['PORT'] = 'badvalue';
    let caughtMessage = '';
    try {
      await startServer({ rendered: makeRendered('<html></html>') });
    } catch (err) {
      caughtMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
    expect(caughtMessage).toContain('badvalue');
  });

  it('rejects when PORT is set to 0 (out of valid range 1-65535)', async () => {
    const origPort = process.env['PORT'];
    process.env['PORT'] = '0';
    try {
      await expect(
        startServer({ rendered: makeRendered('<html></html>') }),
      ).rejects.toThrow(/PORT is invalid/);
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
  });

  it('rejects when PORT is set to a decimal number', async () => {
    const origPort = process.env['PORT'];
    process.env['PORT'] = '80.5';
    try {
      await expect(
        startServer({ rendered: makeRendered('<html></html>') }),
      ).rejects.toThrow(/PORT is invalid/);
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Post-startup error handling
  //
  // After startServer() resolves, post-startup socket errors are forwarded to
  // stderr rather than being silently swallowed or crashing the process via an
  // unhandled 'error' event. This tests the `server.on('error', ...)` handler
  // that is attached inside the listen callback, after the startup handler is
  // detached.
  //
  // The approach: start a server successfully, capture stderr writes by
  // temporarily replacing process.stderr.write, then emit a synthetic 'error'
  // event directly on the server to trigger the post-startup handler.
  // ---------------------------------------------------------------------------

  it('forwards post-startup server errors to stderr rather than leaving them unhandled', async () => {
    const origPort = process.env['PORT'];
    // Use a random OS-assigned port to avoid collisions with other tests.
    delete process.env['PORT'];
    // We need a free port — use 0 trick via a raw server, then free it.
    // Instead, temporarily set a known-free port by using the occupyPort pattern.
    // Actually: startServer with no PORT env defaults to 8080, which may be in
    // use. Use PORT=0 would be rejected (out of range). The simplest safe approach:
    // bind a blocker to reserve a port, free it, then race to use it.
    // Better: bind our own server first on port 0 to get a free port, close it,
    // then set PORT to that number. But there is a TOCTOU window.
    //
    // Cleanest: use createStudioServer directly to get a listening server, then
    // call startServer on a separate port. But startServer reads PORT env.
    //
    // Use the blocker pattern: occupy a port, then use a DIFFERENT approach —
    // start the server on any valid port by relying on the occupyPort() helper
    // from the describe scope. But that helper is scoped to the describe block
    // above. Re-implement inline.
    const blocker = createServer();
    await new Promise<void>((res, rej) => {
      blocker.once('error', rej);
      blocker.listen(0, '0.0.0.0', () => res());
    });
    const addr = blocker.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected addr');
    const freePort = addr.port;
    // Close the blocker to free the port, then immediately set PORT.
    await new Promise<void>((res) => blocker.close(() => res()));

    process.env['PORT'] = String(freePort);
    let capturedServer: import('node:http').Server | undefined;
    try {
      capturedServer = await startServer({ rendered: makeRendered('<html></html>') });

      // Capture writes to stderr.
      const stderrChunks: string[] = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: unknown, ...args: unknown[]) => {
        stderrChunks.push(String(chunk));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (origWrite as any)(chunk, ...args) as boolean;
      };

      try {
        // Emit a synthetic post-startup error directly on the server.
        const syntheticError = new Error('synthetic post-startup socket error');
        capturedServer.emit('error', syntheticError);

        // The error must have been written to stderr, not silently swallowed.
        expect(stderrChunks.some((c) => c.includes('synthetic post-startup socket error'))).toBe(true);
      } finally {
        process.stderr.write = origWrite;
      }
    } finally {
      if (capturedServer) {
        await new Promise<void>((res) => capturedServer!.close(() => res()));
      }
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
  });
});
