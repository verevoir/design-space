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
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
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

let origPort: string | undefined;

describe('serve.ts end-to-end: real document on disk → real server → real HTTP response', () => {
  let tmpDir: string;
  let server: Server | undefined;

  beforeEach(async () => {
    origPort = process.env['PORT'];
    tmpDir = join(tmpdir(), `ds-serve-e2e-${process.pid}-${Date.now()}`);
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    // PORT is process-wide and vitest reuses a worker context across files, so a leaked value
    // would silently steer whichever test runs next in this worker.
    if (origPort === undefined) delete process.env['PORT'];
    else process.env['PORT'] = origPort;
    if (server) {
      await new Promise<void>((res) => server!.close(() => res()));
      server = undefined;
    }
    await rm(tmpDir, { recursive: true, force: true });
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
    // Drive the real composition against the real path. No mocks, and no environment
    // variable telling production code which file to open.
    const { serveDocument } = await import('./serve.js');
    server = await serveDocument(docPath);

    // Fetch from the real server.
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(HTML);
  });

  it('starts and serves normally when a valid gaps sidecar is present', async () => {
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
    const { serveDocument } = await import('./serve.js');
    server = await serveDocument(docPath);

    // No response surfaces gaps today (handleRequest reads only rendered.html), so this can
    // only assert that a well-formed sidecar is read without disturbing startup. Asserting the
    // records reach the served output has to wait until the server actually surfaces them —
    // the same point at which an unreadable sidecar should become a hard failure.
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });
});

describe('serveDocument: an unreadable gaps sidecar does not stop the document being served', () => {
  let tmpDir2: string;
  let srv: Server | undefined;

  beforeEach(async () => {
    tmpDir2 = join(tmpdir(), `ds-serve-gaps-${process.pid}-${Math.abs(Number(process.hrtime.bigint() % 100000n))}`);
    await rm(tmpDir2, { recursive: true, force: true });
    await mkdir(tmpDir2, { recursive: true });
  });

  afterEach(async () => {
    if (srv) {
      await new Promise<void>((res) => srv!.close(() => res()));
      srv = undefined;
    }
    await rm(tmpDir2, { recursive: true, force: true });
  });

  it('serves the document and reports the bad sidecar rather than refusing to start', async () => {
    const docPath = join(tmpDir2, 'document.html');
    await writeFile(docPath, HTML, 'utf-8');
    // A sidecar that exists but is not JSON. Nothing serves gaps yet, so refusing to start
    // here would trade a working page for a warning nobody needed.
    await writeFile(join(tmpDir2, 'document.gaps.json'), 'not json at all{', 'utf-8');

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: Uint8Array | string): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      const { serveDocument } = await import('./serve.js');
      srv = await serveDocument(docPath);
    } finally {
      process.stderr.write = origWrite;
    }

    const addr = srv?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    expect(stderrChunks.join('')).toContain('could not read the gaps sidecar');
  });
});

describe('serve.ts self-start guard', () => {
  it('does not start a server when the module is merely imported', async () => {
    // The container runs `node dist/serve.js`, where this module IS the entry point. An import
    // must not bind a port or read the baked-in document — otherwise importing it for a helper
    // would leave a server running that nobody asked for, which is what used to happen.
    const { ready } = await import('./serve.js');

    await expect(ready).resolves.toBeUndefined();
  });
});

describe('serveDocument: an absent gaps sidecar is silent', () => {
  let quietDir: string;
  let quietSrv: Server | undefined;

  beforeEach(async () => {
    quietDir = join(tmpdir(), `ds-serve-nogaps-${process.pid}-${Math.abs(Number(process.hrtime.bigint() % 100000n))}`);
    await rm(quietDir, { recursive: true, force: true });
    await mkdir(quietDir, { recursive: true });
  });

  afterEach(async () => {
    if (quietSrv) {
      await new Promise<void>((res) => quietSrv!.close(() => res()));
      quietSrv = undefined;
    }
    await rm(quietDir, { recursive: true, force: true });
  });

  it('writes nothing to stderr when there is no sidecar at all', async () => {
    const docPath = join(quietDir, 'document.html');
    await writeFile(docPath, HTML, 'utf-8');
    // No sidecar written. Absent is the ordinary case for an older build and must stay quiet —
    // the warning is reserved for a sidecar that exists and cannot be read.
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: Uint8Array | string): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      const { serveDocument } = await import('./serve.js');
      quietSrv = await serveDocument(docPath);
    } finally {
      process.stderr.write = origWrite;
    }

    expect(stderrChunks.join('')).not.toContain('gaps sidecar');
  });
});

describe('serve.ts as the process entry point', () => {
  let entryDir: string;

  beforeEach(async () => {
    entryDir = join(tmpdir(), `ds-entry-${process.pid}-${Math.abs(Number(process.hrtime.bigint() % 100000n))}`);
    await rm(entryDir, { recursive: true, force: true });
    await mkdir(entryDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(entryDir, { recursive: true, force: true });
  });

  it('starts and announces its port when run as the entry point, the way the container runs it', async () => {
    // The Dockerfile's CMD is `node packages/studio/dist/serve.js`. That path — module as
    // process entry point — is the one line of production behaviour the rest of the suite
    // cannot reach, because every other test imports the module instead of running it.
    // So it is spawned here exactly as the container spawns it.
    const { execFile } = await import('node:child_process');
    const serveJs = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/serve.js');
    const docPath = resolve(dirname(serveJs), 'document.html');
    const hadDocument = await readFile(docPath, 'utf-8').then(
      () => true,
      () => false,
    );
    if (!hadDocument) await writeFile(docPath, HTML, 'utf-8');

    const port = await findFreePort();
    const child = execFile('node', [serveJs], {
      env: { ...process.env, PORT: String(port) },
    });

    try {
      const line = await new Promise<string>((res, rej) => {
        const timer = setTimeout(() => rej(new Error('entry point did not announce a port')), 15_000);
        child.stdout?.on('data', (d: Buffer | string) => {
          const text = String(d);
          if (text.includes('listening on port')) {
            clearTimeout(timer);
            res(text);
          }
        });
        child.on('error', (e) => {
          clearTimeout(timer);
          rej(e);
        });
      });

      expect(line).toContain(`listening on port ${port}`);
    } finally {
      child.kill();
      if (!hadDocument) await rm(docPath, { force: true });
    }
  });
});
