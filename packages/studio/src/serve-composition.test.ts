/**
 * Tests for the serve entry point's composition: that it reads a document from
 * disk and serves it via startServer at / and /health.
 *
 * The wiring is tested here by driving its two dependencies (readFile + startServer) through
 * the public HTTP interface, supplying a real temporary file as the pre-rendered document so
 * the test confirms actual I/O rather than mocked internals. It does not import serve.ts —
 * these tests predate `serveDocument` being exported, and cover the seam rather than the
 * entry point, which serve-entrypoint.test.ts and serve-e2e.test.ts own.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { createStudioServer } from './server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * The serve entry point's composition is: read HTML from disk → pass to
 * createStudioServer → bind and serve. These tests verify the observable
 * contract of that composition without importing the entry module (which
 * would also call main() and try to start a real server on disk).
 *
 * Instead, the tests exercise the seam directly: they write a real document
 * file, instantiate createStudioServer with its content, and confirm the
 * server delivers it over HTTP.
 */
describe('serve entry-point composition: document from disk → createStudioServer', () => {
  let cleanup: (() => void) | undefined;
  let tmpDir: string | undefined;

  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function register(fn: () => void) {
    cleanup = fn;
  }

  it('serves the HTML document at / with status 200', async () => {
    const html = '<!DOCTYPE html><html><body><h1>Test Journey</h1></body></html>';
    const dir = join(tmpdir(), `studio-serve-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    tmpDir = dir;
    const path = join(dir, 'document.html');
    await writeFile(path, html, 'utf-8');

    // Simulate the entry point's composition: read from disk, pass to server.
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path, 'utf-8');
    const server = createStudioServer({ rendered: { html: content, gaps: [] } });
    const base = await bindServer(server, register);

    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
  });

  it('serves the exact HTML content written to disk at /', async () => {
    const html = '<!DOCTYPE html><html><body><p>Broadband Switch Journey</p></body></html>';
    const dir = join(tmpdir(), `studio-serve-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    tmpDir = dir;
    const path = join(dir, 'document.html');
    await writeFile(path, html, 'utf-8');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path, 'utf-8');
    const server = createStudioServer({ rendered: { html: content, gaps: [] } });
    const base = await bindServer(server, register);

    const res = await fetch(`${base}/`);
    const text = await res.text();
    expect(text).toBe(html);
  });

  it('answers /health with status 200', async () => {
    const html = '<html></html>';
    const dir = join(tmpdir(), `studio-serve-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    tmpDir = dir;
    const path = join(dir, 'document.html');
    await writeFile(path, html, 'utf-8');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path, 'utf-8');
    const server = createStudioServer({ rendered: { html: content, gaps: [] } });
    const base = await bindServer(server, register);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  it('/health returns JSON with status=ok', async () => {
    const html = '<html></html>';
    const dir = join(tmpdir(), `studio-serve-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    tmpDir = dir;
    const path = join(dir, 'document.html');
    await writeFile(path, html, 'utf-8');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path, 'utf-8');
    const server = createStudioServer({ rendered: { html: content, gaps: [] } });
    const base = await bindServer(server, register);

    const res = await fetch(`${base}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body['status']).toBe('ok');
  });

  it('a document containing the prompt heading from the reference journey is served at /', async () => {
    // This pins the real observable: the container serves the rendered journey,
    // which contains the first screen's prompt heading.
    const html =
      '<!DOCTYPE html><html><body><h2>Choose a new package</h2></body></html>';
    const dir = join(tmpdir(), `studio-serve-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    tmpDir = dir;
    const path = join(dir, 'document.html');
    await writeFile(path, html, 'utf-8');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path, 'utf-8');
    const server = createStudioServer({ rendered: { html: content, gaps: [] } });
    const base = await bindServer(server, register);

    const res = await fetch(`${base}/`);
    const text = await res.text();
    expect(text).toContain('Choose a new package');
  });

});
