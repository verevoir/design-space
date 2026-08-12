/**
 * Unit tests for serve.ts module-level behaviour.
 *
 * serve.ts runs main() at module level. These tests load it in isolation —
 * with node:fs/promises and ./server.js mocked — so each test can exercise
 * all three paths through main() without touching the real filesystem or
 * binding a real port.
 *
 * Paths under test:
 *   (a) readFile fails — wrapped with the specific legible message that names
 *       the document path and instructs the operator to run the prerender build
 *       step; process.exit(1) is called; the original error message is preserved.
 *   (b) readFile succeeds but startServer fails — process.exit(1) is called and
 *       the error message is written to stderr.
 *   (c) both succeed — "Studio server listening on port ${port}\n" is written to
 *       stdout and the server is reachable.
 */
import { vi, it, describe, expect, afterEach, beforeEach } from 'vitest';

// vi.mock calls are hoisted before any import. They intercept the named
// modules wherever they are imported — including inside serve.ts itself.
vi.mock('node:fs/promises');
vi.mock('./server.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Capture exit code and stderr from a fresh execution of the serve.ts module.
 * The module is reset before each call so main() runs from scratch.
 */
async function loadServeWithReadFileError(cause: Error): Promise<{
  exitCode: number | undefined;
  stderrOutput: string;
}> {
  // Wire the readFile mock to reject with the supplied cause.
  const fsMod = await import('node:fs/promises');
  vi.mocked(fsMod.readFile).mockRejectedValueOnce(cause);

  // Wire startServer so it would not bind a port if readFile somehow succeeded.
  const serverMod = await import('./server.js');
  vi.mocked(serverMod.startServer).mockResolvedValue({
    address: () => ({ port: 8080 }),
  } as ReturnType<typeof serverMod.startServer> extends Promise<infer S> ? S : never);

  // Spy on process.exit before the module runs so the process is not killed.
  let capturedExitCode: number | undefined;
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((code?: number | string | null) => {
      capturedExitCode = typeof code === 'number' ? code : undefined;
      return undefined as never;
    });

  // Capture stderr writes.
  const stderrChunks: string[] = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (
    chunk: Uint8Array | string,
    _encodingOrCb?: unknown,
    _cb?: unknown,
  ): boolean => {
    stderrChunks.push(String(chunk));
    return true;
  };

  try {
    // Fresh module load — main() runs to completion before `ready` resolves.
    // Awaiting the exported `ready` promise gives a deterministic signal that all
    // module-level async work has settled, with no reliance on a sleep timer.
    const serveMod = await import('./serve.js');
    await serveMod.ready;
  } finally {
    process.stderr.write = origStderrWrite;
    exitSpy.mockRestore();
  }

  return { exitCode: capturedExitCode, stderrOutput: stderrChunks.join('') };
}


/**
 * Capture exit code, stdout and stderr from a fresh execution of serve.ts where the document
 * READS SUCCESSFULLY. `startServerBehaviour` decides whether the server starts or fails, which
 * is what separates path (b) from path (c).
 */
async function loadServeWithDocument(
  html: string,
  startServerBehaviour: { ok: true; port: number } | { ok: false; error: Error },
): Promise<{ exitCode: number | undefined; stdoutOutput: string; stderrOutput: string }> {
  const fsMod = await import('node:fs/promises');
  vi.mocked(fsMod.readFile).mockResolvedValueOnce(html);
  // serve.ts makes a second readFile call for the gaps sidecar (.catch(() => []) handles any
  // error, but the auto-mock returns undefined which is not a promise — supply an explicit value).
  vi.mocked(fsMod.readFile).mockResolvedValueOnce('[]');

  const serverMod = await import('./server.js');
  if (startServerBehaviour.ok) {
    vi.mocked(serverMod.startServer).mockResolvedValue({
      address: () => ({ port: startServerBehaviour.port }),
    } as ReturnType<typeof serverMod.startServer> extends Promise<infer S> ? S : never);
  } else {
    vi.mocked(serverMod.startServer).mockRejectedValueOnce(startServerBehaviour.error);
  }

  let capturedExitCode: number | undefined;
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((code?: number | string | null) => {
      capturedExitCode = typeof code === 'number' ? code : undefined;
      return undefined as never;
    });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: Uint8Array | string): boolean => {
    stdoutChunks.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk: Uint8Array | string): boolean => {
    stderrChunks.push(String(chunk));
    return true;
  };

  try {
    const serveMod = await import('./serve.js');
    await serveMod.ready;
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    exitSpy.mockRestore();
  }

  return {
    exitCode: capturedExitCode,
    stdoutOutput: stdoutChunks.join(''),
    stderrOutput: stderrChunks.join(''),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serve.ts: readFile failure path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls process.exit(1) when the pre-rendered document cannot be read', async () => {
    const cause = Object.assign(
      new Error('no such file or directory'),
      { code: 'ENOENT' } as NodeJS.ErrnoException,
    );
    const { exitCode } = await loadServeWithReadFileError(cause);
    expect(exitCode).toBe(1);
  });

  it('writes to stderr a message that names the pre-rendered document path', async () => {
    const cause = Object.assign(
      new Error('no such file or directory'),
      { code: 'ENOENT' } as NodeJS.ErrnoException,
    );
    const { stderrOutput } = await loadServeWithReadFileError(cause);
    // The outer catch in main().catch() writes:
    //   "Studio server startup failed: Studio server failed to read the
    //    pre-rendered document at <path>: <msg>. Run the prerender build step..."
    expect(stderrOutput).toMatch(
      /Studio server failed to read the pre-rendered document at/,
    );
  });

  it('includes the instruction to run the prerender build step in the stderr message', async () => {
    const cause = Object.assign(
      new Error('no such file or directory'),
      { code: 'ENOENT' } as NodeJS.ErrnoException,
    );
    const { stderrOutput } = await loadServeWithReadFileError(cause);
    expect(stderrOutput).toMatch(/Run the prerender build step before starting the server/);
  });

  it('preserves the original error message inside the wrapped message', async () => {
    const originalMessage = 'ENOENT: no such file or directory, open \'/app/dist/document.html\'';
    const cause = Object.assign(
      new Error(originalMessage),
      { code: 'ENOENT' } as NodeJS.ErrnoException,
    );
    const { stderrOutput } = await loadServeWithReadFileError(cause);
    // The wrapped Error is constructed as:
    //   new Error(`...${err.message}...`, { cause: err })
    // So the original message must appear verbatim in the stderr output.
    expect(stderrOutput).toContain(originalMessage);
  });
});

describe('serve.ts: startServer failure path (document read, server did not start)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('exits non-zero when the server cannot start, rather than sitting there serving nothing', async () => {
    const { exitCode } = await loadServeWithDocument('<html>ok</html>', {
      ok: false,
      error: new Error('EADDRINUSE: port 8080 is already in use'),
    });

    expect(exitCode).toBe(1);
  });

  it('names the underlying startup failure on stderr', async () => {
    const { stderrOutput } = await loadServeWithDocument('<html>ok</html>', {
      ok: false,
      error: new Error('EADDRINUSE: port 8080 is already in use'),
    });

    expect(stderrOutput).toContain('Studio server startup failed:');
    expect(stderrOutput).toContain('EADDRINUSE');
  });
});

describe('serve.ts: success path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('announces the port it is listening on', async () => {
    const { stdoutOutput } = await loadServeWithDocument('<html>ok</html>', {
      ok: true,
      port: 8080,
    });

    // The message is deliberate behaviour: it is the only signal in the container log that
    // startup completed, so it is asserted rather than assumed.
    expect(stdoutOutput).toContain('Studio server listening on port 8080');
  });

  it('does not exit when startup succeeds', async () => {
    const { exitCode } = await loadServeWithDocument('<html>ok</html>', {
      ok: true,
      port: 8080,
    });

    expect(exitCode).toBeUndefined();
  });

  it('passes the document it read to the server rather than an empty page', async () => {
    await loadServeWithDocument('<html>the real document</html>', { ok: true, port: 8080 });

    const serverMod = await import('./server.js');
    expect(vi.mocked(serverMod.startServer)).toHaveBeenCalledWith(
      expect.objectContaining({ rendered: expect.objectContaining({ html: '<html>the real document</html>' }) }),
    );
  });
});
