/**
 * Tests for the disk-read bound added to serve.ts's per-request and startup document reads —
 * round 12's fix for the antagonistic review's resilience-lens rejection of `d092ce1`: a
 * per-request `readFile` with no timeout, `AbortSignal`, or other bound could hold a request
 * open indefinitely if the disk stalled.
 *
 * WHY THIS FILE DOES NOT MOCK node:fs/promises (unlike serve-entrypoint.test.ts): the point
 * here is to exercise Node's REAL, documented `signal` support on `fs.promises.readFile` — a
 * mocked `readFile` would prove nothing about whether the real API actually honours an aborted
 * signal the way this fix assumes it does. It already caught one wrong assumption this way —
 * see the note on the first test below.
 *
 * WHAT THIS DOES AND DOES NOT PROVE — read before trusting the coverage this file supplies.
 * Three approaches were considered for proving the timeout is genuinely bounded, not merely
 * wired to look bounded:
 *
 *   1. Pass an ALREADY-ABORTED signal (what this file does) — deterministic and instant: per
 *      Node's own documented contract, `fs.promises.readFile` checks `signal.aborted` and
 *      rejects immediately if it is already set, with no waiting involved. This exercises the
 *      REAL `readFile` + REAL `AbortSignal` machinery, not a mock, and proves what is genuinely
 *      this package's own responsibility: that an abort — however and whenever it actually
 *      fires — is caught and reshaped into a message that names it as a timeout, distinguishable
 *      from an ENOENT or any other fs failure, rather than a generic, unattributed provider
 *      failure. Running this against the real API is what caught a wrong assumption in the
 *      first draft of this fix: `AbortSignal.timeout()`'s own abort reason is documented as a
 *      `TimeoutError` DOMException, but `fs.promises.readFile` does NOT propagate a signal's
 *      `reason` through to its rejection — it throws its own generic `AbortError` ('The
 *      operation was aborted.') regardless of what reason the signal carried. `serve.ts`'s
 *      `describeReadFailure` checks for `'AbortError'`, not `'TimeoutError'`, because of what
 *      this test actually observed, not because of what the `AbortSignal.timeout()` docs alone
 *      would suggest.
 *   2. Fake timers, so a real hanging read genuinely trips `AbortSignal.timeout(ms)`. Rejected:
 *      `AbortSignal.timeout`'s internal timer is scheduled through Node's internal timer
 *      binding, not necessarily through the globally-patchable `setTimeout` that fake-timer
 *      libraries monkey-patch — whether it is interceptable was not established here, and
 *      shipping a test built on an unverified assumption about Node internals is exactly the
 *      "manufactured coverage" this round was warned against.
 *   3. A real, genuinely slow/blocking read (e.g. a FIFO nothing ever writes to), so the
 *      timeout fires in real wall-clock time against a real hang. Rejected: whether Node's
 *      abort signal can actually interrupt a blocked `open()` syscall on a FIFO, or only takes
 *      effect at the next already-scheduled JS-level checkpoint (which a blocked syscall on
 *      libuv's threadpool may never reach), was not established here either — and if it does
 *      NOT interrupt it, this test would hang indefinitely rather than fail, which is a worse
 *      outcome than no test at all: a stuck gate, not a red one.
 *
 * So: this file proves the HANDLING is correct — an abort, once it happens, is diagnosable and
 * distinct from any other failure — using real Node primitives, not mocks or assumptions. It
 * does NOT prove that `AbortSignal.timeout(5_000)` actually fires at real-world 5000ms; that is
 * Node's own documented timer contract, covered by Node's own test suite, not something this
 * package re-verifies. Recorded here plainly rather than left to be assumed from a green run.
 */
import { describe, it, expect } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRenderedDocument, DOCUMENT_READ_TIMEOUT_MS } from './serve.js';

describe('readRenderedDocument(): the disk read is bounded by a signal, and a timeout is diagnosable', () => {
  it('rejects immediately, without reading, when handed an already-aborted signal — the shape a fired timeout produces', async () => {
    const dir = join(tmpdir(), `studio-read-timeout-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'document.html');
    // Written so a passing test that accidentally DID read the file would still be
    // distinguishable from one that correctly rejected before reading it at all.
    await writeFile(path, '<html>should never be read — the signal is already aborted</html>', 'utf-8');

    try {
      // No reason is supplied here deliberately — see this file's header. fs.promises.readFile
      // does not propagate a signal's own `reason` through to its rejection regardless of what
      // it is, so a plain AbortSignal.abort() reproduces the exact same rejection shape a real
      // AbortSignal.timeout() firing does: Node's own generic AbortError.
      const alreadyAborted = AbortSignal.abort();

      await expect(readRenderedDocument(path, [], alreadyAborted)).rejects.toThrow(
        new RegExp(`timed out after ${DOCUMENT_READ_TIMEOUT_MS}ms`),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('distinguishes a timeout from an ENOENT in the diagnostic message, so an operator can tell which happened', async () => {
    // A path that does not exist, with a signal that is NOT aborted — the ordinary failure
    // this catch block already handled before this round. Confirms the new AbortError branch
    // did not swallow or reword the pre-existing ENOENT path.
    const missingPath = join(
      tmpdir(),
      `studio-read-timeout-test-missing-${process.pid}-${Date.now()}.html`,
    );
    const controller = new AbortController();

    await expect(
      readRenderedDocument(missingPath, [], controller.signal),
    ).rejects.toThrow(/ENOENT|no such file/);

    let message = '';
    try {
      await readRenderedDocument(missingPath, [], controller.signal);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain('timed out');
  });

  it('serves the document normally when the signal never aborts, so the bound does not disturb the happy path', async () => {
    const dir = join(tmpdir(), `studio-read-timeout-happy-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'document.html');
    const html = '<html><body>ordinary read, well within the bound</body></html>';
    await writeFile(path, html, 'utf-8');

    try {
      const result = await readRenderedDocument(path, [], AbortSignal.timeout(DOCUMENT_READ_TIMEOUT_MS));
      expect(result.html).toBe(html);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the production timeout bound is 5 seconds — a same-container disk read, not a network call', () => {
    // Pinned so a change to the constant is a deliberate, reviewed decision, not a silent drift.
    expect(DOCUMENT_READ_TIMEOUT_MS).toBe(5_000);
  });
});
