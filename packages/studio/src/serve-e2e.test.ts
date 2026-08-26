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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads the port actually bound by a server, rather than assuming one — every real bind in
 * this file sets PORT=0 and lets the OS choose, so the number is never known ahead of time.
 */
function boundPort(server: Server): number {
  const addr = server.address();
  if (!addr || typeof addr !== 'object') {
    throw new Error('unexpected address shape');
  }
  return addr.port;
}

/**
 * Save and restore `process.env.PORT` around every test in the calling describe block.
 *
 * PORT is process-wide and vitest reuses a worker context across files, so a leaked value
 * would silently steer whichever test runs next in this worker — `server.test.ts` in this
 * same package reads it. Every block below that assigns PORT calls this; a block that
 * assigns PORT without it is the defect this helper exists to make hard to reintroduce.
 */
function preservePortEnv(): void {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env['PORT'];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env['PORT'];
    else process.env['PORT'] = saved;
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

  preservePortEnv();

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
  });

  it('serves the exact bytes written to disk when the document path is real', async () => {
    // Write the pre-rendered document and its gaps sidecar where serve.ts will look.
    const docPath = join(tmpDir, 'document.html');
    const gapsPath = join(tmpDir, 'document.gaps.json');
    await Promise.all([
      writeFile(docPath, HTML, 'utf-8'),
      writeFile(gapsPath, GAPS_JSON, 'utf-8'),
    ]);

    // Ask the OS for a free ephemeral port — no separate probe-and-rebind step, and so no
    // window in which something else could grab the same number first.
    process.env['PORT'] = '0';
    // Drive the real composition against the real path. No mocks, and no environment
    // variable telling production code which file to open.
    const { serveDocument } = await import('./serve.js');
    server = await serveDocument(docPath);
    const port = boundPort(server);

    // Fetch from the real server, on the port it actually bound.
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

    process.env['PORT'] = '0';
    const { serveDocument } = await import('./serve.js');
    server = await serveDocument(docPath);
    const port = boundPort(server);

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

  preservePortEnv();

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

    // PORT=0 asks the OS for a free ephemeral port directly. Without this the server binds
    // startServer's 8080 default and the test passes or fails according to what else is
    // listening on the machine — it passed in CI and failed locally for exactly that reason.
    process.env['PORT'] = '0';

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

describe('this file does not leak PORT between blocks', () => {
  it('gives every describe block that assigns PORT the save/restore hooks', async () => {
    // A structural check, because the defect is invisible at runtime: a block that sets PORT
    // without restoring it still passes on its own, and only steers a *later* file's tests.
    // Two blocks here were written that way and were caught by review rather than by the
    // suite. This makes the third one red instead.
    const source = await readFile(fileURLToPath(import.meta.url), 'utf-8');

    // Chunk the file by describe block; index 0 is everything above the first one, which is
    // where the helper itself lives.
    const blocks = source.split(/^describe\(/m).slice(1);
    expect(blocks.length).toBeGreaterThan(1);

    const offenders = blocks
      .filter((b) => /process\.env\['PORT'\]\s*=/.test(b))
      .filter((b) => !b.includes('preservePortEnv()'))
      .map((b) => b.slice(0, b.indexOf('\n')));

    expect(
      offenders,
      'These describe blocks assign process.env.PORT but never call preservePortEnv(), ' +
        'so the value leaks to whatever vitest runs next in this worker.',
    ).toEqual([]);
  });
});

describe('serveDocument: an absent gaps sidecar is silent', () => {
  let quietDir: string;
  let quietSrv: Server | undefined;

  preservePortEnv();

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

    // No fetch happens in this test — only stderr is inspected — so the port only needs to be
    // free to bind, never read back. PORT=0 asks the OS for one directly.
    process.env['PORT'] = '0';

    try {
      const { serveDocument } = await import('./serve.js');
      quietSrv = await serveDocument(docPath);
    } finally {
      process.stderr.write = origWrite;
    }

    expect(stderrChunks.join('')).not.toContain('gaps sidecar');
  });
});
