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

  describe('/health endpoint', () => {
    it('returns HTTP 200', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
    });

    it('returns JSON with status=ok', async () => {
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/health`);
      const body = await res.json() as Record<string, unknown>;
      expect(body['status']).toBe('ok');
    });

    it('returns the port version in MAJOR.MINOR format', async () => {
      // PORT_VERSION is documented as "MAJOR.MINOR" (two dot-separated integer
      // segments). This assertion checks the actual format — a value like
      // "0.1.0" (three segments) would fail, proving the doc-comment is honoured.
      const server = createStudioServer({ rendered: makeRendered('<html></html>') });
      const base = await bindServer(server, register);
      const res = await fetch(`${base}/health`);
      const body = await res.json() as Record<string, unknown>;
      expect(body['portVersion']).toMatch(/^\d+\.\d+$/);
      // Also confirm it matches what the package exports, so a version bump
      // the server did not pick up would still fail here.
      expect(body['portVersion']).toBe(PORT_VERSION);
    });

    it('reports the Cloud Run revision that answered, sourced from K_REVISION', async () => {
      // Why this field exists and what it distinguishes: docs/architecture.md §9a ("`/health`
      // says which build answered").
      const orig = process.env['K_REVISION'];
      process.env['K_REVISION'] = 'design-space-studio-00042-abc';
      try {
        const server = createStudioServer({ rendered: makeRendered('<html></html>') });
        const base = await bindServer(server, register);
        const res = await fetch(`${base}/health`);
        const body = await res.json() as Record<string, unknown>;
        expect(body['revision']).toBe('design-space-studio-00042-abc');
      } finally {
        if (orig === undefined) {
          delete process.env['K_REVISION'];
        } else {
          process.env['K_REVISION'] = orig;
        }
      }
    });

    it('reports revision as an explicit null off Cloud Run rather than omitting the field', async () => {
      // A missing field is ambiguous between "not running on Cloud Run" and "running on a build
      // too old to report it", and the second is the case a caller must not silently accept.
      const orig = process.env['K_REVISION'];
      delete process.env['K_REVISION'];
      try {
        const server = createStudioServer({ rendered: makeRendered('<html></html>') });
        const base = await bindServer(server, register);
        const res = await fetch(`${base}/health`);
        const body = await res.json() as Record<string, unknown>;
        expect(Object.keys(body)).toContain('revision');
        expect(body['revision']).toBeNull();
      } finally {
        if (orig !== undefined) {
          process.env['K_REVISION'] = orig;
        }
      }
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
  let started: Server | undefined;

  afterEach(async () => {
    if (blocker) {
      await new Promise<void>((res) => blocker!.close(() => res()));
      blocker = undefined;
    }
    if (started) {
      await new Promise<void>((res) => started!.close(() => res()));
      started = undefined;
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

  // ---------------------------------------------------------------------------
  // Success path — startServer() resolves and the server is listening
  // ---------------------------------------------------------------------------

  it('resolves to a listening Server when the port is available', async () => {
    // PORT=0 asks the OS to assign a free ephemeral port directly — no separate probe-then-
    // rebind step, and so no window in which something else could grab the same number.
    const origPort = process.env['PORT'];
    process.env['PORT'] = '0';
    try {
      const server = await startServer({ rendered: makeRendered('<html></html>') });
      started = server;
      const addr = server.address();
      expect(addr).not.toBeNull();
      expect(typeof addr).toBe('object');
      if (!addr || typeof addr !== 'object') throw new Error('unexpected address shape');
      // The bound port is read back off the server, never assumed — the OS chose it.
      expect(addr.port).toBeGreaterThan(0);
      expect(addr.port).toBeLessThanOrEqual(65535);
      // Confirm it is actually serving HTTP, on the port actually bound.
      const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }
  });

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

  it('accepts PORT=0 as "let the OS assign a free ephemeral port", not an out-of-range value', async () => {
    // 0 is Node's own convention for OS-assigned ports (net.Server.listen(0, ...)), not a
    // malformed value — rejecting it is what used to force every real-server test in this
    // package onto a racy probe-and-rebind workaround instead of binding directly.
    const origPort = process.env['PORT'];
    process.env['PORT'] = '0';
    try {
      const server = await startServer({ rendered: makeRendered('<html></html>') });
      started = server;
      const addr = server.address();
      expect(addr && typeof addr === 'object' ? addr.port : 0).toBeGreaterThan(0);
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

  it('rejects when PORT is set to 65536 (one above the valid upper bound)', async () => {
    // The guard is `port > 65535`; this test pins the upper bound by supplying
    // the first integer above it. PORT=65535 is the last valid value; 65536 must be rejected.
    const origPort = process.env['PORT'];
    process.env['PORT'] = '65536';
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
  // Strategy: call startServer() on a known-free port so it resolves
  // successfully, then emit a synthetic 'error' event on the returned server
  // and assert that the post-startup handler forwarded it to stderr. This
  // exercises startServer() — the function that wires up the post-startup
  // handler — rather than recreating the handler manually.
  // ---------------------------------------------------------------------------

  it('forwards post-startup server errors to stderr rather than leaving them unhandled', async () => {
    // Let startServer() bind on a free, OS-assigned port and resolve.
    const origPort = process.env['PORT'];
    process.env['PORT'] = '0';
    let server: Server;
    try {
      server = await startServer({ rendered: makeRendered('<html></html>') });
      started = server;
    } finally {
      if (origPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = origPort;
      }
    }

    // Capture writes to stderr.
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;
    process.stderr.write = (chunk: unknown, encodingOrCb?: unknown, cb?: unknown): boolean => {
      stderrChunks.push(String(chunk));
      return (origWrite as (c: unknown, e?: unknown, cb?: unknown) => boolean)(chunk, encodingOrCb, cb);
    };

    try {
      // Emit a synthetic post-startup error directly on the server.
      // startServer() wires a post-startup 'error' handler inside its listen
      // callback; that handler must forward this to stderr.
      const syntheticError = new Error('synthetic post-startup socket error');
      server.emit('error', syntheticError);

      // The error must have been written to stderr, not silently swallowed.
      expect(stderrChunks.some((c) => c.includes('synthetic post-startup socket error'))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });
});
