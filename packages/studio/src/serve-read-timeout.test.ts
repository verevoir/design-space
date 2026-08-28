/**
 * Tests for the disk-read bound added to serve.ts's per-request, startup-probe and
 * gaps-sidecar reads — round 12's fix for the antagonistic review's resilience-lens rejection
 * of `d092ce1` (a per-request `readFile` with no timeout, `AbortSignal`, or other bound could
 * hold a request open indefinitely if the disk stalled), extended in round 13 to cover the
 * other two read sites: round 12 only made `readRenderedDocument` take `signal` as an
 * injectable parameter, leaving `serveDocument`'s startup probe and gaps-sidecar reads
 * constructing `AbortSignal.timeout()` inline — bounded, but with their `AbortError` branches
 * unreachable by any test. `probeDocumentReadable` and `readGapsSidecar` now take the same
 * injectable-`signal` shape, and this file drives all three the same way.
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
 *
 * WHY THE ASSERTIONS BELOW CHECK THE EXACT "timed out after ...ms" WORDING, NOT JUST "did it
 * reject/write something": the reviewer who found this gap named the specific regression a
 * weaker assertion would miss — `describeReadFailure`'s `err.name === 'AbortError'` check
 * silently reverting to `err.code` (which an `AbortError` does not set) would still make the
 * read fail, and would still produce SOME message, but the message would be Node's generic
 * "The operation was aborted." rather than the diagnostic this fix exists to supply. Every
 * abort-path assertion below therefore matches the specific timeout wording, not merely
 * "rejects" or "writes to stderr" — so that exact regression fails these tests, not just a
 * hypothetical total breakage.
 */
import { describe, it, expect } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readRenderedDocument,
  probeDocumentReadable,
  readGapsSidecar,
  DOCUMENT_READ_TIMEOUT_MS,
} from './serve.js';

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

describe('probeDocumentReadable(): the startup probe read is bounded by an injectable signal, and a timeout is diagnosable', () => {
  it('rejects with the specific timeout wording when handed an already-aborted signal', async () => {
    const dir = join(tmpdir(), `studio-probe-timeout-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'document.html');
    await writeFile(path, '<html>should never be read — the signal is already aborted</html>', 'utf-8');

    try {
      const alreadyAborted = AbortSignal.abort();
      // Matches the exact wording, not merely "rejects" — see this file's header on why a
      // weaker assertion would not catch describeReadFailure reverting to err.code.
      await expect(probeDocumentReadable(path, alreadyAborted)).rejects.toThrow(
        new RegExp(`timed out after ${DOCUMENT_READ_TIMEOUT_MS}ms`),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still names ENOENT distinctly from a timeout, so the pre-existing startup-failure message is unchanged', async () => {
    const missingPath = join(
      tmpdir(),
      `studio-probe-timeout-missing-${process.pid}-${Date.now()}.html`,
    );
    const controller = new AbortController();

    let message = '';
    try {
      await probeDocumentReadable(missingPath, controller.signal);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/ENOENT|no such file/);
    expect(message).not.toContain('timed out');
    expect(message).toContain('Run the prerender build step before starting the server');
  });

  it('resolves without disturbing the happy path when the signal never aborts', async () => {
    const dir = join(tmpdir(), `studio-probe-timeout-happy-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'document.html');
    await writeFile(path, '<html>ordinary probe read</html>', 'utf-8');

    try {
      await expect(
        probeDocumentReadable(path, AbortSignal.timeout(DOCUMENT_READ_TIMEOUT_MS)),
      ).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('readGapsSidecar(): the sidecar read is bounded by an injectable signal, and a timeout is diagnosable on stderr', () => {
  it('reports the specific timeout wording on stderr, and serves an empty gap list, when handed an already-aborted signal', async () => {
    // readGapsSidecar never throws for a non-ENOENT failure — it logs to stderr and returns []
    // (see its own doc comment: an unreadable sidecar must not stop a good document being
    // served). So the timeout diagnostic has to be observed on stderr, the same way
    // serve-e2e.test.ts's existing "unreadable gaps sidecar" test observes a JSON.parse
    // failure — this is the identical mechanism, just triggered by an abort instead.
    const dir = join(tmpdir(), `studio-sidecar-timeout-test-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const gapsPath = join(dir, 'document.gaps.json');
    // Valid JSON, so a passing test that accidentally DID read the file would still be
    // distinguishable — the real assertion is that this content is never reached at all.
    await writeFile(gapsPath, '[]', 'utf-8');

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: Uint8Array | string): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      const alreadyAborted = AbortSignal.abort();
      const gaps = await readGapsSidecar(gapsPath, alreadyAborted);
      expect(gaps).toEqual([]);
    } finally {
      process.stderr.write = origWrite;
      await rm(dir, { recursive: true, force: true });
    }

    const stderrOutput = stderrChunks.join('');
    // Matches the exact wording, not merely "wrote something to stderr" — see this file's
    // header on why a weaker assertion would not catch describeReadFailure reverting to
    // err.code, which would still produce SOME stderr line, just the wrong one.
    expect(stderrOutput).toContain(`timed out after ${DOCUMENT_READ_TIMEOUT_MS}ms`);
    expect(stderrOutput).toContain('could not read the gaps sidecar');
  });

  it('stays silent on stderr and serves an empty list for an absent sidecar, unaffected by the signal change', async () => {
    const missingPath = join(
      tmpdir(),
      `studio-sidecar-timeout-missing-${process.pid}-${Date.now()}.json`,
    );
    const controller = new AbortController();

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: Uint8Array | string): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    };

    let gaps: readonly unknown[];
    try {
      gaps = await readGapsSidecar(missingPath, controller.signal);
    } finally {
      process.stderr.write = origWrite;
    }

    expect(gaps).toEqual([]);
    expect(stderrChunks.join('')).toBe('');
  });

  it('reads the real sidecar content when the signal never aborts, so the bound does not disturb the happy path', async () => {
    const dir = join(tmpdir(), `studio-sidecar-timeout-happy-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const gapsPath = join(dir, 'document.gaps.json');
    const records = [{ screenId: 'screen-1', component: 'compare-set' }];
    await writeFile(gapsPath, JSON.stringify(records), 'utf-8');

    try {
      const gaps = await readGapsSidecar(gapsPath, AbortSignal.timeout(DOCUMENT_READ_TIMEOUT_MS));
      expect(gaps).toEqual(records);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
