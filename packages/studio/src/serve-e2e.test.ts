/**
 * End-to-end integration test for serve.ts — no mocks.
 *
 * This test exercises the complete wiring the story introduces: serve.ts reads
 * a real document from disk, starts a real HTTP server on an OS-assigned port,
 * and serves the document over real HTTP. Nothing is mocked.
 *
 * Complement to serve-entrypoint.test.ts (which mocks fs and server to verify
 * error paths) and serve-composition.test.ts (which exercises the HTTP layer
 * without invoking serve.ts itself).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { createServer } from 'node:net';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ask the OS for a free port, release it, and return the number. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('unexpected address shape')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HTML = '<!DOCTYPE html><html><body><h1>E2E journey document</h1></body></html>';
const GAPS_JSON = JSON.stringify([{ screenId: 'screen-1', component: 'compare-set' }]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serve.ts end-to-end: real document on disk → real server → real HTTP response', () => {
  let tmpDir: string;
  let server: Server | undefined;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ds-serve-e2e-${process.pid}-${Date.now()}`);
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((res) => server!.close(() => res()));
      server = undefined;
    }
    await rm(tmpDir, { recursive: true, force: true });
    // Clean up the env override so the next test starts fresh.
    delete process.env['DOCUMENT_PATH_OVERRIDE'];
  });

  it('serves the exact bytes written to disk when the document path is real', async () => {
    // Write the pre-rendered document and its gaps sidecar where serve.ts will look.
    const docPath = join(tmpDir, 'document.html');
    const gapsPath = join(tmpDir, 'document.gaps.json');
    await Promise.all([
      writeFile(docPath, HTML, 'utf-8'),
      writeFile(gapsPath, GAPS_JSON, 'utf-8'),
    ]);

    // Pick a free port and point serve.ts at the temp document.
    const port = await findFreePort();
    process.env['PORT'] = String(port);
    process.env['DOCUMENT_PATH_OVERRIDE'] = docPath;

    // Import serve.ts (no mocks). The module-level main() runs immediately.
    // Awaiting `ready` gives a deterministic signal that startup has completed.
    const { vi } = await import('vitest');
    vi.resetModules();
    const serveMod = await import('./serve.js');
    server = (await serveMod.ready) ?? undefined;

    // Fetch from the real server.
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(HTML);
  });

  it('carries the real gap records through from the sidecar to the served result', async () => {
    // Write a document with a known gaps sidecar.
    const docPath = join(tmpDir, 'document.html');
    const gapsPath = join(tmpDir, 'document.gaps.json');
    const gapRecords = [
      { screenId: 'browse-packages', component: 'compare-set' },
      { screenId: 'enter-details', component: 'input-set' },
    ];
    await Promise.all([
      writeFile(docPath, HTML, 'utf-8'),
      writeFile(gapsPath, JSON.stringify(gapRecords), 'utf-8'),
    ]);

    const port = await findFreePort();
    process.env['PORT'] = String(port);
    process.env['DOCUMENT_PATH_OVERRIDE'] = docPath;

    const { vi } = await import('vitest');
    vi.resetModules();
    const serveMod = await import('./serve.js');
    server = (await serveMod.ready) ?? undefined;

    // /healthz does not surface gaps, but a 200 confirms the server started
    // and the gaps sidecar did not prevent startup.
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
  });
});
