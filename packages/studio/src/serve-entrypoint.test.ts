/**
 * Unit tests for serve.ts module-level behaviour.
 *
 * serve.ts runs main() at module level. These tests load it in isolation —
 * with node:fs/promises and ./server.js mocked — so each test can exercise
 * a single path (readFile failure, startServer failure, success) without
 * touching the real filesystem or binding a real port.
 *
 * Behaviour under test:
 *   - readFile failure is wrapped with the specific legible message that names
 *     the document path and instructs the operator to run the prerender build
 *     step before starting the server.
 *   - The original ENOENT error message is preserved inside the wrapped message
 *     so the underlying cause is not lost.
 *   - process.exit(1) is called whenever main() rejects, so a misconfigured
 *     container fails loudly rather than silently.
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
    // Fresh module load — main().catch() runs synchronously up to the first
    // await, then the async tail settles in the microtask queue.
    await import('./serve.js');
    // Drain the microtask queue so the main().catch() handler has run.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  } finally {
    process.stderr.write = origStderrWrite;
    exitSpy.mockRestore();
  }

  return { exitCode: capturedExitCode, stderrOutput: stderrChunks.join('') };
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
