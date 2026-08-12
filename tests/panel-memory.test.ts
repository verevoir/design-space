import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(
  new URL('../.github/antagonistic-review/panel-memory.sh', import.meta.url)
);

/** A diff hash of the shape the workflow's stamp step produces — 64 lowercase
 * hex. Derived rather than hand-typed so a test never accidentally uses one the
 * script would reject for its shape when the point of the test is elsewhere. */
const hashOf = (seed: string) => createHash('sha256').update(seed, 'utf8').digest('hex');

const DIFF_A = hashOf('diff-a');
const DIFF_B = hashOf('diff-b');

/**
 * A locale that interleaves case in its collation, SUPPLIED to the script by the
 * uppercase-hex test rather than hoped for. A CI runner defaults to C, where
 * uppercase hex is refused with or without `export LC_ALL=C` — so without handing
 * the script this, that test asserts the charset guard and proves nothing about
 * the pin, on precisely the machine that runs the gate. Where the locale is not
 * generated bash falls back to C and the assertion holds for the ordinary reason:
 * never weaker, never skipped.
 */
const CASE_FOLDING_LOCALE = 'en_US.UTF-8';

/** One lens's contribution to a run, as the two files its artifact carries.
 * `null` means "the file is absent" — a lens that died wrote no verdict, and a
 * stamp step that could not resolve the range wrote no hash. */
interface LensArtifact {
  verdict?: string | null;
  hash?: string | null;
}

/** A verdict.json body. Raw so a test can put something malformed in it. */
const verdictJson = (v: string, findings: string[] = []) =>
  JSON.stringify({ verdict: v, summary: 'one line', findings });

interface Ledger {
  version: number;
  entries: { diffHash: string; at: string; verdicts: Record<string, string> }[];
}

const entry = (
  diffHash: string,
  verdicts: Record<string, string>,
  at = '2026-01-01T00:00:00Z'
) => ({
  diffHash,
  at,
  verdicts,
});

const ledgerOf = (...entries: Ledger['entries']): string => JSON.stringify({ version: 1, entries });

interface MemoryRun {
  code: number;
  stdout: string;
  /** The ledger as it stands AFTER the run, or null when the script wrote none
   * — which includes the case where a seeded unparseable file was left exactly
   * as it was found. `raw` is what distinguishes those two. */
  ledger: Ledger | null;
  /** The ledger file's raw bytes after the run — for "was it left untouched?". */
  raw: string | null;
}

/**
 * Lay out `verdict-<lens>/{verdict.json,diff-hash.txt}` in a throwaway dir,
 * optionally seed a prior ledger, and run the script over them. The subprocess
 * is bounded generously so a genuinely-hung script fails the test loudly rather
 * than hanging the suite (aggregate.test.ts's discipline: a killed process must
 * never be read as an ordinary non-zero exit).
 */
async function memory(
  lenses: Record<string, LensArtifact>,
  opts: { ledger?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<MemoryRun> {
  const dir = await mkdtemp(join(tmpdir(), 'panel-memory-'));
  try {
    const verdicts = join(dir, 'verdicts');
    const ledgerPath = join(dir, 'memory', 'ledger.json');
    for (const [lens, artifact] of Object.entries(lenses)) {
      const d = join(verdicts, `verdict-${lens}`);
      await mkdir(d, { recursive: true });
      if (artifact.verdict !== null && artifact.verdict !== undefined) {
        await writeFile(join(d, 'verdict.json'), artifact.verdict);
      }
      if (artifact.hash !== null && artifact.hash !== undefined) {
        await writeFile(join(d, 'diff-hash.txt'), `${artifact.hash}\n`);
      }
    }
    if (opts.ledger !== undefined) {
      await mkdir(join(dir, 'memory'), { recursive: true });
      await writeFile(ledgerPath, opts.ledger);
    }

    let code = 0;
    let stdout = '';
    try {
      const result = await run('bash', [SCRIPT, verdicts, ledgerPath], {
        env: { ...process.env, ...opts.env },
        timeout: 20000,
      });
      stdout = result.stdout;
    } catch (e) {
      const err = e as { code?: number; stdout?: string; killed?: boolean; signal?: string };
      if (err.killed || err.signal) {
        throw new Error(
          `panel-memory.sh was killed (${err.signal ?? 'timeout'}) — hung, not finished`
        );
      }
      code = err.code ?? 1;
      stdout = err.stdout ?? '';
    }

    const raw = existsSync(ledgerPath) ? await readFile(ledgerPath, 'utf8') : null;
    let ledger: Ledger | null = null;
    if (raw !== null) {
      try {
        ledger = JSON.parse(raw) as Ledger;
      } catch {
        // A seeded-but-unparseable file the script declined to rewrite. Throwing
        // here would report a passing behaviour as a broken harness.
        ledger = null;
      }
    }
    return { code, stdout, raw, ledger };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The last recorded entry — what the NEXT run will compare against. */
const latest = (m: MemoryRun) => m.ledger?.entries.at(-1);

/** True if any output line begins with the given GitHub Actions `::command`.
 * The script emits `::warning` annotations of its own, so tests inject commands
 * it never writes (`::set-env`, `::add-mask`) — a hit is then unambiguously
 * untrusted text reaching the runner as a command. */
const leaks = (stdout: string, command: string) =>
  stdout.split(/\r?\n|\r/).some((l) => l.startsWith(command));

/** A `jq` that never returns, for proving the bound around it actually fires. */
async function jqHanging(): Promise<string> {
  const stubBin = await mkdtemp(join(tmpdir(), 'panel-memory-jqhang-'));
  await writeFile(join(stubBin, 'jq'), '#!/usr/bin/env bash\nsleep 30\n');
  await chmod(join(stubBin, 'jq'), 0o755);
  return stubBin;
}

/**
 * A `jq` that behaves normally except for ONE invocation, identified by a flag only
 * that call passes. This is what closed a gap this file previously DECLARED: the
 * two "could not be encoded" / "could not be rewritten" branches fire only when a
 * specific jq call fails, and the one lever available then (JQ_BOUNDED_TIMEOUT) is
 * shared by every call — shrinking it failed the first parse and the run exited
 * before either branch was reached.
 *
 * Selecting on the flag reaches them individually: the verdict encode is the only
 * call passing `-R`, and the ledger rewrite the only one passing `--argjson`.
 */
async function jqFailingOn(flag: string): Promise<string> {
  const stubBin = await mkdtemp(join(tmpdir(), 'panel-memory-jq-'));
  const { stdout } = await run('which', ['jq'], { timeout: 5_000 });
  const realJq = stdout.trim();
  await writeFile(
    join(stubBin, 'jq'),
    `#!/usr/bin/env bash\nfor a in "$@"; do [ "$a" = "${flag}" ] && exit 1; done\nexec ${realJq} "$@"\n`
  );
  await chmod(join(stubBin, 'jq'), 0o755);
  return stubBin;
}

/**
 * The external commands panel-memory.sh shells out to, plus `bash` itself.
 *
 * Used by the timeout-fallback test, which has to REPLACE PATH rather than
 * prepend to it: `command -v timeout` must genuinely fail, and a prepended
 * directory cannot hide a binary further along. Everything the script needs
 * therefore has to be present in the stub, `bash` included — `execFile('bash',
 * …)` resolves through the same PATH, so an omission means the subprocess never
 * launches (ENOENT) or dies at 127, either of which reads exactly like the
 * branch under test being broken.
 */
const SCRIPT_BINARIES = [
  'bash',
  'jq',
  'basename',
  'cut',
  'date',
  'dirname',
  'head',
  'mkdir',
  'mktemp',
  'mv',
  'rm',
  'sort',
  'tr',
  'wc',
] as const;

/** Absolute paths for SCRIPT_BINARIES, or null if any is absent on this machine. */
async function resolveScriptBinaries(): Promise<Record<string, string> | null> {
  const resolved: Record<string, string> = {};
  for (const bin of SCRIPT_BINARIES) {
    try {
      const { stdout } = await run('which', [bin], { timeout: 5_000 });
      const path = stdout.trim();
      if (!path) return null;
      resolved[bin] = path;
    } catch {
      return null;
    }
  }
  return resolved;
}

describe('panel-memory.sh — recording what the panel decided', () => {
  it('records every judging lens against the diff hash the workflow stamped', async () => {
    const m = await memory({
      correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
      security: { verdict: verdictJson('REJECT', ['x']), hash: DIFF_A },
    });
    expect(latest(m)).toMatchObject({
      diffHash: DIFF_A,
      verdicts: { correctness: 'APPROVE', security: 'REJECT' },
    });
  });

  it('says plainly that a first review has nothing to check itself against', async () => {
    // Silence here would read as "the panel was consistent", which is a claim
    // no first run is entitled to make.
    const m = await memory({ correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } });
    expect(m.stdout).toContain('First review of this diff');
  });

  it('reports the panel agreeing with itself when every lens repeats its verdict', async () => {
    const m = await memory(
      {
        correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
        security: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
      },
      { ledger: ledgerOf(entry(DIFF_A, { correctness: 'APPROVE', security: 'APPROVE' })) }
    );
    expect(m.stdout).toContain('2 lens judgement(s) on this diff');
    expect(m.stdout).toContain('match what the panel said last time');
  });

  it('keeps the memory bounded, dropping the oldest entries past the cap', async () => {
    // Unbounded, a long-lived PR's ledger grows once per push forever. The cap
    // is the same "memory is bounded, not infinite" rule the local lap ledger
    // states; without it the file is the only thing in this design with no bound.
    const m = await memory(
      { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_B } },
      {
        ledger: ledgerOf(
          entry(hashOf('old-1'), { correctness: 'APPROVE' }),
          entry(hashOf('old-2'), { correctness: 'APPROVE' })
        ),
        env: { PANEL_MEMORY_MAX_ENTRIES: '2' },
      }
    );
    expect(m.ledger?.entries).toHaveLength(2);
    expect(m.ledger?.entries.map((e) => e.diffHash)).toEqual([hashOf('old-2'), DIFF_B]);
  });
});

describe('panel-memory.sh — a lens that changes its mind about text that did not move', () => {
  const flipped = () =>
    memory(
      { correctness: { verdict: verdictJson('REJECT', ['x']), hash: DIFF_A } },
      { ledger: ledgerOf(entry(DIFF_A, { correctness: 'APPROVE' })) }
    );

  it('names the lens, both verdicts, and the diff they were about', async () => {
    // The wording is the deliverable. "correctness rejected" reads as a fact
    // about the change; this has to read as the panel contradicting itself, or
    // a flip stays indistinguishable from a genuine new finding — the exact
    // ambiguity this script exists to remove.
    const m = await flipped();
    expect(m.stdout).toContain('correctness');
    expect(m.stdout).toContain('previously APPROVED');
    expect(m.stdout).toContain('now REJECTS');
    expect(m.stdout).toContain(DIFF_A.slice(0, 12));
  });

  it('raises it under a fixed annotation title, so flips are countable across runs', async () => {
    // A per-run wording would make the rate unmeasurable — the whole point of
    // turning the anecdote into an event is that somebody can grep for it.
    const m = await flipped();
    expect(m.stdout).toMatch(/^::warning title=Panel non-determinism::/m);
  });

  it('reports the reverse flip too — a REJECT that became an APPROVE', async () => {
    // Only checking APPROVE->REJECT would miss the more dangerous direction: a
    // green the panel has no consistent reason to have given.
    const m = await memory(
      { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
      { ledger: ledgerOf(entry(DIFF_A, { correctness: 'REJECT' })) }
    );
    expect(m.stdout).toContain('previously REJECTED');
    expect(m.stdout).toContain('now APPROVES');
  });

  it('leaves the gate verdict alone — it exits 0 even having found a flip', async () => {
    // A flip is a defect of the panel, not of the change. Failing on one would
    // double-block an APPROVE->REJECT (already blocked) and make a recovered
    // green unreachable on a REJECT->APPROVE.
    const m = await flipped();
    expect(m.code).toBe(0);
  });

  it('does not call a different verdict on a DIFFERENT diff a flip', async () => {
    // Every push would otherwise be reported as non-determinism, and a report
    // that fires on everything is read by nobody.
    const m = await memory(
      { correctness: { verdict: verdictJson('REJECT', ['x']), hash: DIFF_B } },
      { ledger: ledgerOf(entry(DIFF_A, { correctness: 'APPROVE' })) }
    );
    expect(m.stdout).not.toContain('Panel non-determinism');
    expect(m.stdout).toContain('First review of this diff');
  });

  it('compares against the most recent verdict for the hash, not the first', async () => {
    // A lens that went APPROVE -> REJECT -> REJECT is stable now; reporting it
    // against the oldest entry forever would re-raise a flip already recorded.
    const m = await memory(
      { correctness: { verdict: verdictJson('REJECT', ['x']), hash: DIFF_A } },
      {
        ledger: ledgerOf(
          entry(DIFF_A, { correctness: 'APPROVE' }, '2026-01-01T00:00:00Z'),
          entry(DIFF_A, { correctness: 'REJECT' }, '2026-01-02T00:00:00Z')
        ),
      }
    );
    expect(m.stdout).not.toContain('Panel non-determinism');
    // Paired with a POSITIVE assertion deliberately: absence of the flip message
    // alone would also be satisfied by a lookup that found nothing at all, so the
    // test would keep passing with the comparison silently not happening.
    expect(m.stdout).toContain('match what the panel said last time');
  });
});

describe('panel-memory.sh — a review that did not happen must not leave a record', () => {
  it('records nothing at all when no lens produced a verdict', async () => {
    // The rule the local ledger already holds (applyLensRun: a PARSE-FAILURE or
    // TIMEOUT touches nothing), carried into CI. Recording the hash on a dead
    // run would make the NEXT run believe this diff had been reviewed and
    // approved — a green manufactured out of an outage.
    const before = ledgerOf(entry(DIFF_A, { correctness: 'APPROVE' }));
    const m = await memory(
      {
        correctness: { verdict: null, hash: DIFF_A },
        security: { verdict: null, hash: DIFF_A },
      },
      { ledger: before }
    );
    expect(m.raw).toBe(before);
    expect(m.stdout).toContain('recording nothing');
  });

  it('still records the lenses that survived when one of them died', async () => {
    // Per-lens, not all-or-nothing: a single dead panelist must not erase the
    // memory of the four that actually reviewed.
    const m = await memory({
      correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
      security: { verdict: null, hash: DIFF_A },
    });
    expect(latest(m)?.verdicts).toEqual({ correctness: 'APPROVE' });
  });

  it('ignores a lens whose verdict is neither APPROVE nor REJECT', async () => {
    // "rubric unavailable", a truncated write, or a model that answered in prose
    // are all not-a-judgement. Recording one as though it were would put a
    // verdict in the ledger the lens never reached.
    const m = await memory({
      correctness: { verdict: verdictJson('MAYBE'), hash: DIFF_A },
      security: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
    });
    expect(latest(m)?.verdicts).toEqual({ security: 'APPROVE' });
  });

  it('ignores a lens whose verdict.json is not JSON at all', async () => {
    const m = await memory({
      correctness: { verdict: 'not json {{{', hash: DIFF_A },
      security: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
    });
    expect(latest(m)?.verdicts).toEqual({ security: 'APPROVE' });
  });

  it('ignores a verdict the workflow never stamped a hash for', async () => {
    // A verdict with no key cannot be remembered against anything. Filing it
    // under a guessed or empty hash would collide unrelated reviews.
    const m = await memory({
      correctness: { verdict: verdictJson('APPROVE'), hash: null },
      security: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
    });
    expect(latest(m)?.verdicts).toEqual({ security: 'APPROVE' });
  });

  it('refuses a diff hash that is not the shape the stamp step produces', async () => {
    // The hash is interpolated into output and used as a lookup key; anything
    // but 64 hex is a stamp step that failed open, not a change to remember.
    const m = await memory({
      correctness: { verdict: verdictJson('APPROVE'), hash: 'deadbeef' },
      security: { verdict: verdictJson('APPROVE'), hash: `${DIFF_A}zz` },
    });
    expect(m.ledger).toBeNull();
    expect(m.stdout).toContain('recording nothing');
  });

  it('refuses a 64-character key that is not hex', async () => {
    // Separate from the length check, and not redundant with it: a
    // right-length-wrong-charset value is the one shape a length test alone
    // waves through, and the value is interpolated into the log and used as a
    // lookup key.
    //
    // UPPERCASE HEX, deliberately, and not 'z'. `case "$h" in *[!0-9a-f]*)` is a
    // COLLATION test: under a locale that interleaves case only A-F sort inside
    // a-f, so a 'z' fixture is refused whether or not the script pins the locale.
    //
    // The fixture alone is still not enough, and the locale below is the other
    // half. A CI runner defaults to C, where even 'A' is refused with or without
    // the pin — so hoping for a case-folding locale makes this test real on a
    // developer's machine and vacuous in the gate. Handing the script one closes
    // that: with the pin it overrides and refuses, without it inherits and
    // accepts. Deleting `export LC_ALL=C` now turns this red everywhere.
    const m = await memory(
      { correctness: { verdict: verdictJson('APPROVE'), hash: 'A'.repeat(64) } },
      { env: { LC_ALL: CASE_FOLDING_LOCALE } }
    );
    expect(m.ledger).toBeNull();
    expect(m.stdout).toContain('recording nothing');
  });

  it('records nothing when the lenses disagree about which diff they reviewed', async () => {
    // Disagreement means the range moved under the panel. There is no single
    // change this run judged, so there is no honest key to file it under —
    // picking one lens's hash would attribute other lenses' verdicts to a diff
    // they never saw.
    const m = await memory({
      correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
      security: { verdict: verdictJson('APPROVE'), hash: DIFF_B },
    });
    expect(m.ledger).toBeNull();
    expect(m.stdout).toContain('did not all review the same change');
  });
});

describe('panel-memory.sh — a corrupt memory costs the memory, never the run', () => {
  it('treats a malformed ledger as empty and still records this run', async () => {
    const m = await memory(
      { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
      {
        ledger: '{ this is not json',
      }
    );
    expect(m.code).toBe(0);
    expect(latest(m)).toMatchObject({ diffHash: DIFF_A });
  });

  it('treats a ledger of the wrong shape as empty rather than trusting it', async () => {
    // A v2 file, or one whose entries are not an array, would otherwise flow
    // into the jq lookups and produce silent nonsense instead of a fresh start.
    const m = await memory(
      { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
      {
        ledger: JSON.stringify({ version: 2, entries: 'nope' }),
      }
    );
    expect(m.ledger?.version).toBe(1);
    expect(m.ledger?.entries).toHaveLength(1);
  });

  it('refuses to parse an oversize ledger', async () => {
    // Bounded like aggregate.sh's verdict read: size is decided from a capped
    // read, so a pathological file can never be consumed whole.
    const huge = JSON.stringify({ version: 1, entries: [], pad: 'x'.repeat(1_100_000) });
    const m = await memory(
      { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
      {
        ledger: huge,
      }
    );
    expect(m.ledger?.entries).toHaveLength(1);
  });

  it('refuses to parse an oversize verdict', async () => {
    const huge = JSON.stringify({ verdict: 'APPROVE', summary: 'x'.repeat(1_100_000) });
    const m = await memory({
      correctness: { verdict: huge, hash: DIFF_A },
      security: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
    });
    expect(latest(m)?.verdicts).toEqual({ security: 'APPROVE' });
  });

  it('always exits 0 — the memory reports, it never gates', async () => {
    // Read together with the `continue-on-error` on the workflow step: both
    // layers exist so a bug here can never be the reason a merge is blocked.
    const m = await memory({}, { ledger: 'garbage' });
    expect(m.code).toBe(0);
  });
});

describe('panel-memory.sh — nothing it echoes can become a runner command', () => {
  it('reduces a lens directory name to the lens alphabet before printing OR storing it', async () => {
    // The name comes from the base workflow's matrix, but it is the one value
    // here that is not a fixed token — and a name carrying `::` or a newline
    // would otherwise open a workflow command of its own (aggregate.sh's
    // drift-guard defence, applied to the same input). Driven through the FLIP
    // path deliberately: that is the only path that echoes a lens name, so a
    // first-run fixture would assert the sanitisation without ever reaching it.
    // The stored key is asserted too — an unsanitised name is also the one that
    // would be split on its own whitespace when the entry is encoded.
    const m = await memory(
      { '::set-env name=x': { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
      { ledger: ledgerOf(entry(DIFF_A, { 'set-envnamex': 'REJECT' })) }
    );
    expect(leaks(m.stdout, '::set-env')).toBe(false);
    expect(m.stdout).toContain('set-envnamex: this diff');
    expect(Object.keys(latest(m)?.verdicts ?? {})).toEqual(['set-envnamex']);
  });

  it('drops a lens whose name sanitises away to nothing', async () => {
    // The residue case the sanitiser test above cannot reach: `::set-env name=x`
    // still leaves `set-envnamex` behind, so `[ -n "$lens" ] || continue` never
    // fires for it. A name made ENTIRELY of characters outside the lens alphabet
    // strips to the empty string, and without that guard the judgement is stored
    // under an empty key — which reads back as a lens on every subsequent run and
    // could report a flip for a lens that does not exist.
    //
    // The healthy neighbour is the other half of the assertion: the bad name must
    // cost its own lens's contribution and nothing else.
    const m = await memory({
      ':::@@@': { verdict: verdictJson('APPROVE'), hash: DIFF_A },
      security: { verdict: verdictJson('APPROVE'), hash: DIFF_A },
    });
    expect(m.code).toBe(0);
    expect(Object.keys(latest(m)?.verdicts ?? {})).toEqual(['security']);
  });

  it('kills a hanging jq at the bound rather than holding the step open', async () => {
    // Fault injection on the bound itself, which is what the sibling suite does for
    // its `git diff` wrapper and this one did not. Everything else here proves the
    // script handles jq FAILING; nothing proved the timeout fires on a jq that never
    // returns — the failure mode the bound exists for, and the one that costs the
    // whole step rather than one lens's contribution.
    //
    // Wall-clock is part of the assertion: the stub sleeps far past the bound, so a
    // fast return can only mean the bound fired.
    const stubBin = await jqHanging();
    try {
      const startedAt = process.hrtime.bigint();
      const m = await memory(
        { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
        { env: { PATH: `${stubBin}:${process.env['PATH'] ?? ''}`, JQ_BOUNDED_TIMEOUT: '1' } }
      );
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

      expect(m.code).toBe(0);
      expect(m.ledger).toBeNull();
      // Generous against a loaded machine, and still far below the stub's sleep.
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await rm(stubBin, { recursive: true, force: true });
    }
  });

  it("warns and records nothing when this run's verdicts cannot be encoded", async () => {
    // A one-line degradation carrying its own ::warning title, and the reason the
    // script can promise exit 0 whatever jq does. Untested it could be deleted and
    // the failure would surface as a silently empty ledger entry instead.
    const stubBin = await jqFailingOn('-R');
    try {
      const m = await memory(
        { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
        { env: { PATH: `${stubBin}:${process.env['PATH'] ?? ''}` } }
      );
      expect(m.code).toBe(0);
      expect(m.stdout).toContain('::warning title=Panel memory not updated::');
      expect(m.stdout).toContain('could not be encoded');
      expect(m.ledger).toBeNull();
    } finally {
      await rm(stubBin, { recursive: true, force: true });
    }
  });

  it('warns and leaves the prior ledger intact when the rewrite fails', async () => {
    // The other half, and the one with something to lose: a prior ledger exists, so
    // the assertion is that it is left EXACTLY as found rather than truncated or
    // half-written. Losing a round of memory is the accepted cost; corrupting the
    // memory that was already there is not.
    const stubBin = await jqFailingOn('--argjson');
    const priorLedger = ledgerOf(entry(DIFF_B, { correctness: 'APPROVE' }));
    try {
      const m = await memory(
        { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
        { ledger: priorLedger, env: { PATH: `${stubBin}:${process.env['PATH'] ?? ''}` } }
      );
      expect(m.code).toBe(0);
      expect(m.stdout).toContain('::warning title=Panel memory not updated::');
      expect(m.stdout).toContain('could not be rewritten');
      expect(m.raw).toBe(priorLedger);
    } finally {
      await rm(stubBin, { recursive: true, force: true });
    }
  });

  it('never echoes a verdict value it did not recognise', async () => {
    // The model writes verdict.json. An unrecognised value is dropped without
    // being quoted back, so a crafted one has no path to the log at all.
    const m = await memory({
      correctness: { verdict: verdictJson('::add-mask::secret'), hash: DIFF_A },
    });
    expect(m.stdout).not.toContain('add-mask');
    expect(leaks(m.stdout, '::add-mask')).toBe(false);
  });

  it('refuses a JQ_BOUNDED_TIMEOUT of zero, which coreutils reads as no bound', async () => {
    // Same hole as stamp-diff-hash.sh's, in the override that bounds every parse of
    // panelist-controlled JSON below: `timeout 0 cmd` means "no time limit". Until
    // this guard the value was not validated at all, so a zero — or a word — went
    // straight to the command line and removed the bound while looking like config.
    for (const bound of ['0', '00', 'abc']) {
      const m = await memory(
        { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
        { env: { JQ_BOUNDED_TIMEOUT: bound } }
      );
      expect(m.code, `bound ${bound}`).toBe(0);
      expect(m.ledger, `bound ${bound}`).toBeNull();
      expect(m.stdout, `bound ${bound}`).toMatch(
        /JQ_BOUNDED_TIMEOUT is not a positive whole number/
      );
    }
  });

  it('records nothing at all when there is no bounded timeout available', async (ctx) => {
    // `jq_bounded()` wraps every jq call in `timeout`, and the parses it wraps read
    // panelist-controlled JSON. A bare-jq fallback for hosts without coreutils
    // traded a fast, bounded failure for an UNBOUNDED parse — on exactly the hosts
    // where no job timer is watching. This script reports and never gates, so an
    // absent `timeout` is one more thing to report and decline.
    //
    // Asserted on the LEDGER: exit 0 is what the script promises on every path, so
    // only "nothing was recorded" distinguishes declining from proceeding.
    const bins = await resolveScriptBinaries();
    if (!bins) {
      ctx.skip(); // a binary the script needs is absent here; nothing to prove
      return;
    }
    const stubBin = await mkdtemp(join(tmpdir(), 'panel-memory-nobin-'));
    try {
      for (const [name, target] of Object.entries(bins)) {
        await symlink(target, join(stubBin, name));
      }
      const m = await memory(
        { correctness: { verdict: verdictJson('APPROVE'), hash: DIFF_A } },
        { env: { PATH: stubBin } }
      );
      expect(m.code).toBe(0);
      expect(m.ledger).toBeNull();
      expect(m.stdout).toMatch(/no bounded timeout available/);
    } finally {
      await rm(stubBin, { recursive: true, force: true });
    }
  });
});
