import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Behaviour tests for scripts/smoke.sh
//
// Each describe block stands up a real local HTTP server that returns a
// controlled response, runs smoke.sh against it once in beforeAll, and
// asserts on the cached result in each it().  This exercises the script's
// actual curl invocations and status checks — no mocking.
//
// runSmoke uses spawn (async) rather than spawnSync so the Node.js event
// loop remains free to process incoming HTTP requests while the script runs.
// Using spawnSync would block the event loop and cause the local HTTP servers
// to time out, making every curl call appear as a connection failure.
//
// Coverage:
//   happy path   — 200 with correct body  → exit 0
//   wrong body   — 200 with missing heading → exit 1 with legible FAIL line
//   server error — 500 on both routes     → exit 1 with legible FAIL line
//   conn refused — target port is closed  → exit 1 with legible FAIL line
//                  (regression: set -e used to kill the script before any
//                   output appeared)
//   token env    — SMOKE_ID_TOKEN env var → Authorization header sent
// ---------------------------------------------------------------------------

const SMOKE_SH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../scripts/smoke.sh',
);

// Heading and health-body strings smoke.sh asserts on.
const GOOD_BODY_ROOT   = '<html><body><h1>Choose a new package</h1></body></html>';
const GOOD_HEALTH_BODY = '{"status":"ok","portVersion":"1.0"}';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RouteMap = Record<string, { status: number; body: string }>;

function makeServer(routes: RouteMap): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const path = req.url ?? '/';
      const route = routes[path];
      if (route) {
        res.writeHead(route.status, { 'Content-Type': 'text/html' });
        res.end(route.body);
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('unexpected server address'));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}

type RunResult = { exitCode: number; stdout: string; stderr: string };

/**
 * Run smoke.sh against baseUrl and return stdout, stderr and the exit code.
 *
 * Uses spawn (async) rather than spawnSync so the Node.js event loop is free
 * to service incoming HTTP requests from the curl calls inside the script.
 * spawnSync would block the event loop and cause every local HTTP server to
 * appear unreachable (curl-error-28 / timeout).
 */
function runSmoke(baseUrl: string, env?: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [SMOKE_SH, baseUrl], {
      env: {
        ...process.env,
        // Use a 3-second curl timeout so connection failures are reported quickly
        // rather than waiting 30 s (smoke.sh's production default).
        SMOKE_CURL_MAX_TIME: '3',
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code: number | null) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Happy path — 200 with correct body on both routes
// ---------------------------------------------------------------------------

describe('smoke.sh — happy path: 200 with expected body', { timeout: 15_000 }, () => {
  let server: Server;
  let result: RunResult;

  beforeAll(async () => {
    const s = await makeServer({
      '/':       { status: 200, body: GOOD_BODY_ROOT },
      '/health': { status: 200, body: GOOD_HEALTH_BODY },
    });
    server = s.server;
    result = await runSmoke(`http://127.0.0.1:${s.port}`);
  });

  afterAll(() => { server.close(); });

  it('exits 0 when both checks pass', () => {
    expect(result.exitCode).toBe(0);
  });

  it('reports OK lines for both routes', () => {
    expect(result.stdout).toContain('OK    GET /  status 200');
    expect(result.stdout).toContain('OK    GET /health  status 200');
  });

  it('prints "smoke: all checks passed" on success', () => {
    expect(result.stdout).toContain('smoke: all checks passed');
  });
});

// ---------------------------------------------------------------------------
// Wrong body — 200 status but missing reference-journey heading
// ---------------------------------------------------------------------------

describe('smoke.sh — 200 response with wrong body', { timeout: 15_000 }, () => {
  let server: Server;
  let result: RunResult;

  beforeAll(async () => {
    const s = await makeServer({
      '/':       { status: 200, body: '<html><body><h1>Something else entirely</h1></body></html>' },
      '/health': { status: 200, body: GOOD_HEALTH_BODY },
    });
    server = s.server;
    result = await runSmoke(`http://127.0.0.1:${s.port}`);
  });

  afterAll(() => { server.close(); });

  it('exits non-zero when the reference journey heading is absent', () => {
    expect(result.exitCode).not.toBe(0);
  });

  it('emits a FAIL line naming the missing heading', () => {
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/FAIL.*GET \/.*heading/i);
  });

  it('does not print "smoke: all checks passed"', () => {
    expect(result.stdout).not.toContain('smoke: all checks passed');
  });
});

// ---------------------------------------------------------------------------
// Server error — 500 on the root route
// ---------------------------------------------------------------------------

describe('smoke.sh — 500 response from server', { timeout: 15_000 }, () => {
  let server: Server;
  let result: RunResult;

  beforeAll(async () => {
    const s = await makeServer({
      '/':       { status: 500, body: 'Internal Server Error' },
      '/health': { status: 500, body: 'Internal Server Error' },
    });
    server = s.server;
    result = await runSmoke(`http://127.0.0.1:${s.port}`);
  });

  afterAll(() => { server.close(); });

  it('exits non-zero on a 500 response', () => {
    expect(result.exitCode).not.toBe(0);
  });

  it('emits a FAIL line quoting the received status', () => {
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/FAIL.*GET \/.*500/);
  });
});

// ---------------------------------------------------------------------------
// Connection refused — target is not listening
//
// Regression test: under the original smoke.sh the `_status_ref="$(curl ...)"` command
// substitution ran under set -euo pipefail, so a curl connection failure (non-zero exit)
// killed the script before any FAIL line was printed.  After the fix the curl exit
// status is captured explicitly and the script continues to completion.
// ---------------------------------------------------------------------------

describe('smoke.sh — connection refused (no server listening)', { timeout: 10_000 }, () => {
  // Port 1 is in the privileged range and is never in use in a test environment.
  // curl will fail at the TCP-connect layer (ECONNREFUSED) almost instantly.
  let result: RunResult;

  beforeAll(async () => {
    result = await runSmoke('http://127.0.0.1:1');
  });

  it('exits non-zero when the target is not reachable', () => {
    expect(result.exitCode).not.toBe(0);
  });

  it('emits a FAIL line rather than aborting silently', () => {
    // Before the fix, set -e killed the script before this line could be printed.
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/FAIL/);
  });

  it('prints "smoke: one or more checks FAILED" rather than no summary', () => {
    // Before the fix the script would exit mid-run with no summary line.
    const output = result.stdout + result.stderr;
    expect(output).toContain('smoke: one or more checks FAILED');
  });
});

// ---------------------------------------------------------------------------
// Token env precedence — SMOKE_ID_TOKEN is read from the environment, not $2
// ---------------------------------------------------------------------------

describe('smoke.sh — SMOKE_ID_TOKEN env var takes precedence over positional $2', { timeout: 15_000 }, () => {
  // The server records Authorization header values it receives.
  const authValues: string[] = [];
  let server: Server;

  beforeAll(async () => {
    // Stand up the server using the same await-then-runSmoke pattern as other
    // tests so the event loop is free to process requests during runSmoke.
    // The server uses a custom request handler to capture Authorization headers.
    const s = await new Promise<{ server: Server; port: number }>((resolve, reject) => {
      const srv = createServer((req, res) => {
        // Node.js lowercases all incoming header names.
        const auth = req.headers['authorization'];
        if (auth) authValues.push(auth);
        const path = req.url ?? '/';
        if (path === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(GOOD_BODY_ROOT);
        } else if (path === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(GOOD_HEALTH_BODY);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
        resolve({ server: srv, port: addr.port });
      });
      srv.on('error', reject);
    });
    server = s.server;
    // Run smoke.sh with SMOKE_ID_TOKEN set and no positional $2; the
    // Authorization header on every request must carry the env-var value.
    await runSmoke(`http://127.0.0.1:${s.port}`, { SMOKE_ID_TOKEN: 'env-token' });
  });

  afterAll(() => { server.close(); });

  it('sends Bearer env-token in the Authorization header when SMOKE_ID_TOKEN is set', () => {
    // Both GET / and GET /health are called, so at least two headers should be
    // recorded.  Every one must carry the env-var value.
    expect(authValues.length).toBeGreaterThan(0);
    for (const h of authValues) {
      // Node.js strips the header name; the value is the part after "Bearer ".
      // curl sends "Authorization: Bearer <token>" — Node receives just the value.
      expect(h).toBe('Bearer env-token');
    }
  });
});

describe('smoke.sh — /health body checks', () => {
  let server: import('node:http').Server;
  let port = 0;

  afterEach(async () => {
    if (server) await new Promise<void>((res) => server.close(() => res()));
  });

  /** Stand up a server whose / is fine but whose /health body is the caller's choice. */
  async function serveHealth(body: string): Promise<number> {
    const { createServer } = await import('node:http');
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>Choose a new package</html>');
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const addr = server.address();
    return addr && typeof addr === 'object' ? addr.port : 0;
  }

  it('fails when /health omits status:ok, naming what it got', async () => {
    port = await serveHealth('{"status":"degraded","portVersion":"0.1"}');
    const r = await runSmoke(`http://127.0.0.1:${port}`);

    // Two distinct branches guard this endpoint; this one is the status field.
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/FAIL.*\/health.*status:ok/);
    expect(r.stderr).toContain('degraded');
  });

  it('fails when /health omits portVersion', async () => {
    port = await serveHealth('{"status":"ok"}');
    const r = await runSmoke(`http://127.0.0.1:${port}`);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/FAIL.*\/health.*portVersion/);
  });

  it('accepts the spaced JSON form, since a server may format either way', async () => {
    port = await serveHealth('{"status": "ok", "portVersion": "0.1"}');
    const r = await runSmoke(`http://127.0.0.1:${port}`);

    expect(r.exitCode).toBe(0);
  });
});
