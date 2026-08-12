import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createStudioServer } from './server.js';
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
