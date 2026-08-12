import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(
  new URL('../.github/antagonistic-review/stamp-diff-hash.sh', import.meta.url)
);

/**
 * A locale that interleaves case in its collation, supplied to the script by the
 * uppercase-hex tests so the bug the `export LC_ALL=C` pin exists to stop is
 * actually reachable on the machine running the suite. A CI runner defaults to C,
 * where uppercase hex is refused with or without the pin — so without supplying
 * this, those tests would assert the charset guard and prove nothing about the
 * pin. Where the locale is not generated, bash falls back to C and the assertion
 * simply holds for the ordinary reason.
 */
const CASE_FOLDING_LOCALE = 'en_US.UTF-8';

// Strip any repo-pointing git vars the runner environment might carry — they
// would redirect the fixture's git operations into the real repository instead
// of the per-test temp dir.
const {
  GIT_DIR: _d,
  GIT_WORK_TREE: _w,
  GIT_INDEX_FILE: _i,
  GIT_OBJECT_DIRECTORY: _o,
  ...cleanEnv
} = process.env;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...cleanEnv,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test',
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, env: GIT_ENV, timeout: 20_000 });
  return stdout.trim();
}

/**
 * Create a bare repo with two commits on `main` and return the two shas.
 * `base` is the first commit's sha (the "merge base" the diff will start from),
 * `head` is the second commit's sha (the tip being reviewed).
 */
async function repoFixture(): Promise<{ dir: string; work: string; base: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'stamp-diff-hash-'));
  try {
    await run('git', ['init', '-b', 'main', dir], { env: GIT_ENV, timeout: 20_000 });
    await run(
      'git',
      [
        '-c',
        'user.email=test@test',
        '-c',
        'user.name=test',
        'commit',
        '--allow-empty',
        '-m',
        'base',
      ],
      { cwd: dir, env: GIT_ENV, timeout: 20_000 }
    );
    const base = await git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, 'file.txt'), 'hello\n');
    await git(dir, 'add', 'file.txt');
    await run(
      'git',
      ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-m', 'head'],
      { cwd: dir, env: GIT_ENV, timeout: 20_000 }
    );
    const head = await git(dir, 'rev-parse', 'HEAD');
    return { dir, work: dir, base, head };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

interface StampResult {
  code: number;
  stdout: string;
  /** Raw bytes of diff-hash.txt after the run, or null if the file was absent. */
  hashFile: string | null;
  /** Raw bytes of the diff file after the run, or null if the file was absent. */
  diffFile: string | null;
}

/**
 * Run stamp-diff-hash.sh inside `cwd` with the given env vars and paths.
 * Always resolves — never rejects — so tests can assert on exit code freely.
 */
async function stamp(
  cwd: string,
  env: Partial<
    Record<'BASE_SHA' | 'HEAD_SHA' | 'LENS' | 'LC_ALL' | 'PATH' | 'DIFF_TIMEOUT_SECONDS', string>
  >,
  outDir: string,
  diffFile: string
): Promise<StampResult> {
  // Build the subprocess environment: start from GIT_ENV (which strips all the
  // repo-redirecting vars), add the caller's overrides, but do NOT spread
  // process.env again — GIT_ENV already carries PATH and the rest of the
  // non-git ambient environment.
  const runEnv: NodeJS.ProcessEnv = { ...GIT_ENV };
  // Remove any inherited sha vars so a test that omits one gets a genuinely
  // absent variable, not whatever happened to be set in the outer process.
  delete runEnv['BASE_SHA'];
  delete runEnv['HEAD_SHA'];
  delete runEnv['LENS'];
  delete runEnv['LC_ALL'];
  Object.assign(runEnv, env);

  try {
    const { stdout } = await run('bash', [SCRIPT, outDir, diffFile], {
      cwd,
      env: runEnv,
      timeout: 30_000,
    });
    const hashFile = existsSync(join(outDir, 'diff-hash.txt'))
      ? await readFile(join(outDir, 'diff-hash.txt'), 'utf8')
      : null;
    const diffFile2 = existsSync(diffFile) ? await readFile(diffFile, 'utf8') : null;
    return { code: 0, stdout, hashFile, diffFile: diffFile2 };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; killed?: boolean; signal?: string };
    if (err.killed || err.signal) {
      throw new Error(
        `stamp-diff-hash.sh was killed (${err.signal ?? 'timeout'}) — hung, not finished`
      );
    }
    const hashFile = existsSync(join(outDir, 'diff-hash.txt'))
      ? await readFile(join(outDir, 'diff-hash.txt'), 'utf8')
      : null;
    const diffFile2 = existsSync(diffFile) ? await readFile(diffFile, 'utf8') : null;
    return { code: err.code ?? 1, stdout: err.stdout ?? '', hashFile, diffFile: diffFile2 };
  }
}

// Per-test bound set above the helper's 30s subprocess cap.
describe(
  'stamp-diff-hash.sh — keying panel memory against the reviewed diff',
  { timeout: 35_000 },
  () => {
    // ─── 1. Happy path ──────────────────────────────────────────────────────────

    it('writes a 64-char lowercase-hex hash that equals the sha256 of the diff bytes', async () => {
      // If the hash file merely echoed a pre-computed constant, the independent
      // node:crypto check would catch it: the node sha256 of the same diff bytes
      // must match, or the file is lying about which diff it represents.
      const { dir, work, base, head } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        const result = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, outDir, diffPath);

        expect(result.code).toBe(0);
        expect(result.hashFile).not.toBeNull();

        // Must be exactly 64 lowercase hex chars (plus trailing newline from sha256sum).
        const hash = result.hashFile!.trim();
        expect(hash).toMatch(/^[0-9a-f]{64}$/);

        // Independently compute the sha256 of the diff bytes the script wrote.
        expect(result.diffFile).not.toBeNull();
        const independent = createHash('sha256').update(result.diffFile!, 'utf8').digest('hex');
        expect(hash).toBe(independent);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    // ─── 2. Stability and uniqueness ────────────────────────────────────────────

    it('produces the same hash across two runs for the same sha pair', async () => {
      // The hash is used as a memory key: if it were non-deterministic the panel
      // would never recognise its own prior run and consistency checking would
      // silently degrade to "first review" every time.
      const { dir, work, base, head } = await repoFixture();
      try {
        const outA = join(dir, 'out-a');
        const outB = join(dir, 'out-b');
        const diffA = join(dir, 'diff-a.diff');
        const diffB = join(dir, 'diff-b.diff');
        await mkdir(outA, { recursive: true });
        await mkdir(outB, { recursive: true });

        const r1 = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, outA, diffA);
        const r2 = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, outB, diffB);

        expect(r1.code).toBe(0);
        expect(r2.code).toBe(0);
        expect(r1.hashFile!.trim()).toBe(r2.hashFile!.trim());
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('produces a different hash when HEAD_SHA differs', async () => {
      // A stale memory key would let an attacker recycle a prior verdict against a
      // different diff — the key must encode WHICH diff was judged.
      const { dir, work, base, head: head1 } = await repoFixture();
      try {
        // Add a second commit so we have a third sha to use as a different HEAD.
        await writeFile(join(work, 'extra.txt'), 'world\n');
        await git(work, 'add', 'extra.txt');
        await run(
          'git',
          ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-m', 'second'],
          { cwd: work, env: GIT_ENV, timeout: 20_000 }
        );
        const head2 = await git(work, 'rev-parse', 'HEAD');

        const outA = join(dir, 'out-a');
        const outB = join(dir, 'out-b');
        const diffA = join(dir, 'diff-a.diff');
        const diffB = join(dir, 'diff-b.diff');
        await mkdir(outA, { recursive: true });
        await mkdir(outB, { recursive: true });

        const r1 = await stamp(work, { BASE_SHA: base, HEAD_SHA: head1 }, outA, diffA);
        const r2 = await stamp(work, { BASE_SHA: base, HEAD_SHA: head2 }, outB, diffB);

        expect(r1.code).toBe(0);
        expect(r2.code).toBe(0);
        expect(r1.hashFile!.trim()).not.toBe(r2.hashFile!.trim());
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    // ─── 3. Clearing guarantee ──────────────────────────────────────────────────
    //
    // A panelist runs before this script and may write any value into diff-hash.txt.
    // The script MUST remove that file before any guard can return, so a degraded
    // run can never leave a panelist-chosen value in place to be uploaded as the
    // authentic hash. Each sub-test pre-seeds the attacker value then checks for
    // ABSENCE, not merely non-update.

    it('creates the output directory when it does not exist yet', async () => {
      // `mkdir -p "$out_dir"` is the script's first act and every other test hands
      // it a directory that already exists — so the flag could be dropped, or the
      // line deleted, and the whole suite would stay green while the real lens job
      // (which runs before anything has created .antagonistic-review/) failed at
      // the redirect.
      const { dir, work, base, head } = await repoFixture();
      try {
        const outDir = join(dir, 'not', 'created', 'yet');
        const diffPath = join(dir, 'review.diff');
        expect(existsSync(outDir)).toBe(false);

        const result = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, outDir, diffPath);

        expect(result.code).toBe(0);
        expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('removes a pre-existing diff-hash.txt when BASE_SHA is empty — exit 0', async () => {
      // An empty BASE_SHA means no merge base was resolved; there is no meaningful
      // diff range, so hashing anything would produce a key that cannot be verified.
      // The clearing must happen before the emptiness check, not after, or the file
      // survives on this path and poisons the memory with the panelist's value.
      const { dir, work } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

        const result = await stamp(work, { BASE_SHA: '', HEAD_SHA: 'abc123' }, outDir, diffPath);

        expect(result.code).toBe(0);
        expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('removes a pre-existing diff-hash.txt when BASE_SHA is uppercase hex — exit 0', async () => {
      // This is the LC_ALL=C regression test. Under a locale that interleaves case
      // (macOS default), 'A'–'F' sort inside 'a'–'f', so `case "$sha" in *[!0-9a-f]*)`
      // would ACCEPT uppercase hex as valid without the `export LC_ALL=C` pin.
      // Using 'A' repeated (not 'Z') is deliberate: 'Z' falls outside a-f in any
      // locale, so that fixture would be rejected even with the pin deleted — it
      // would prove nothing about the collation bug.
      //
      // THE FIXTURE ALONE IS NOT ENOUGH — the tempting mistake, and the one worth
      // stating because it looks like a complete test. A CI runner's default locale is C, where 'A'
      // is refused whether or not the script pins the locale — so on the machine
      // that actually runs the gate, deleting `export LC_ALL=C` would leave this
      // green. The interleaving locale has to be SUPPLIED, which is what the
      // LC_ALL below does: with the pin, the script overrides it and refuses;
      // without the pin, it inherits it and accepts. Now the test fails on the
      // runner too.
      //
      // Where that locale is not generated, bash falls back to C and this degrades
      // to an ordinary charset assertion — never weaker than before, and no test
      // is skipped on a machine's locale inventory.
      const { dir, work } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

        // 40 uppercase-A characters: valid-length sha1-shaped string but NOT lowercase hex.
        const nonHexBase = 'A'.repeat(40);
        const result = await stamp(
          work,
          { BASE_SHA: nonHexBase, HEAD_SHA: 'abc123', LC_ALL: CASE_FOLDING_LOCALE },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('removes a pre-existing diff-hash.txt when HEAD_SHA is uppercase hex — exit 0', async () => {
      // The hex-validation loop checks BOTH sha bounds. A script that only
      // validated BASE_SHA would pass this test with the HEAD_SHA guard deleted.
      // Uppercase hex under a supplied case-folding locale, for the same reason as
      // the BASE_SHA test above: without both, the fixture proves the charset arm
      // fires but says nothing about the locale pin that makes it a byte test.
      const { dir, work } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

        const nonHexHead = 'A'.repeat(40);
        const result = await stamp(
          work,
          { BASE_SHA: 'abc123', HEAD_SHA: nonHexHead, LC_ALL: CASE_FOLDING_LOCALE },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('removes a pre-existing diff-hash.txt when shas are valid hex but non-existent — exit 0', async () => {
      // A well-formed sha that no object in the repo knows about causes `git diff`
      // itself to fail. Without this guard, the WRONG key path (hash of an empty
      // or partial output) would look like a successful stamp.
      const { dir, work } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

        // 40 valid lowercase hex chars — well-formed as a sha but absent from the repo.
        const ghostSha = 'deadbeef'.repeat(5);
        const result = await stamp(
          work,
          { BASE_SHA: ghostSha, HEAD_SHA: ghostSha },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    // ─── 4. Legible reasons on degraded paths ───────────────────────────────────

    it('prints a reason on stdout when BASE_SHA is empty', async () => {
      // A silent skip is indistinguishable from a crash: the operator must be able
      // to see WHY a lens contributed nothing to the panel memory.
      const { dir, work } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        const result = await stamp(work, { BASE_SHA: '', HEAD_SHA: 'abc123' }, outDir, diffPath);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('no resolved merge base');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('prints a reason on stdout when a sha bound fails the hex check', async () => {
      // Same legibility requirement for the non-hex path — both degrade silently
      // otherwise and leave the operator with no log line to grep.
      const { dir, work } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        const result = await stamp(
          work,
          { BASE_SHA: 'A'.repeat(40), HEAD_SHA: 'abc123' },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('non-sha range bound');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('prints a reason on stdout when git diff fails due to a non-existent sha', async () => {
      // The third degraded path — `git diff` itself failing — must also be legible.
      // Without this check, the script could swallow the git error and exit silently.
      const { dir, work } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        const ghostSha = 'deadbeef'.repeat(5);
        const result = await stamp(
          work,
          { BASE_SHA: ghostSha, HEAD_SHA: ghostSha },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('could not materialise the reviewed diff');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    // ─── 5. LENS variable ───────────────────────────────────────────────────────

    it('includes LENS in the success message when set', async () => {
      // The success line names the lens so an operator reading multi-lens logs can
      // correlate each memory key line with the lens that produced it.
      const { dir, work, base, head } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        const result = await stamp(
          work,
          { BASE_SHA: base, HEAD_SHA: head, LENS: 'security' },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('security');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('falls back to a readable label when LENS sanitises away to nothing', async () => {
      // The residue case the sanitiser test below cannot reach: 'x::set-env name=y'
      // still leaves 'xset-envnamey' behind, so `[ -n "$lens" ] || lens=lens` never
      // fires for it. A name made ENTIRELY of characters outside the lens alphabet
      // strips to the empty string, and without the fallback the memory-key line
      // reads "memory key for :" — a log line that has lost the one thing it exists
      // to say. panel-memory.sh's equivalent guard has its own test; this is the
      // asymmetry that keeps recurring between these two scripts.
      const { dir, work, base, head } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        const result = await stamp(
          work,
          { BASE_SHA: base, HEAD_SHA: head, LENS: ':::@@@' },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/memory key for lens:/);
        expect(result.stdout).not.toMatch(/memory key for :/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('reduces LENS to the lens alphabet before echoing it', async () => {
      // panel-memory.sh sanitises this same matrix-sourced value and this script
      // did not, which is the asymmetry a reviewer caught: two scripts reading one
      // input and printing to one log, one defending and one not. The matrix is
      // base-branch config today, so this is depth rather than a live hole — but a
      // `::`-bearing name reaching the log is a workflow command, and the defence
      // costs one line.
      //
      // Asserted on the OUTPUT, not merely on exit 0: the script exits 0 whichever
      // way, so only the absence of the sequence shows the sanitiser ran.
      const { dir, work, base, head } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        const result = await stamp(
          work,
          { BASE_SHA: base, HEAD_SHA: head, LENS: 'x::set-env name=y' },
          outDir,
          diffPath
        );

        expect(result.code).toBe(0);
        expect(result.stdout).not.toContain('::set-env');
        expect(result.stdout).toContain('xset-envnamey');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('succeeds without crashing when LENS is unset (set -u guard)', async () => {
      // `set -u` in the script turns an unset variable into a fatal error. The
      // script defaults LENS to "lens" via `${LENS:-lens}`, so an absent env var
      // must not cause a crash — this test would fail with a non-zero exit code if
      // that default were removed and set -u fired instead.
      const { dir, work, base, head } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });

        // Explicitly omit LENS — the stamp helper already deletes it from runEnv.
        const result = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, outDir, diffPath);

        expect(result.code).toBe(0);
        expect(result.hashFile).not.toBeNull();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    // ─── 6. Degraded hashing paths ────────────────────────────────────────────────

    // These are NOT in this block. They need a stub PATH rather than this block's
    // fixtures, so they live in the top-level `stamp-diff-hash.sh — degraded tool
    // availability` describe at the foot of the file. Said here because the numbered
    // sections are how a reader navigates this file, and a numbered section that
    // silently contains nothing reads as a gap in coverage rather than a pointer.

    // ─── 7. Exit-0 in every case (consolidated explicit assertions) ─────────────
    //
    // Exit code 0 is the script's central promise: it must NEVER gate a merge.
    // The assertions above already cover exit code per case, but the description
    // in each test makes that code visible as a first-class requirement, not a
    // side-effect check. No additional combined test is needed — each case above
    // asserts `expect(result.code).toBe(0)` explicitly as its first non-null check.
    //
    // A non-hex HEAD_SHA is already covered above ('removes a pre-existing
    // diff-hash.txt when HEAD_SHA is uppercase hex'). What is NOT covered there is
    // the EMPTY head bound, which reaches the `''` arm of the same `case` rather
    // than its charset arm — a different branch, and the one a loop written to
    // check only the first element would silently skip:

    it('exits 0 when HEAD_SHA is empty (both bound directions of the hex loop)', async () => {
      // The hex loop iterates over [base_sha, head_sha] in order. Putting the bad
      // value in HEAD_SHA and a valid one in BASE_SHA ensures the loop reaches the
      // second iteration and still exits 0, not 1 or the shell's 127.
      const { dir, work, base } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

        const result = await stamp(work, { BASE_SHA: base, HEAD_SHA: '' }, outDir, diffPath);

        expect(result.code).toBe(0);
        // An empty HEAD_SHA hits the '' branch of the case, which exits 0 and clears.
        expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
);

// ─── Degraded environments and planted paths ─────────────────────────────────
//
// What follows targets branches that exist because the happy path is not always
// available — unreachable by the tests above, which supply a functioning system
// PATH and an unmolested filesystem.

// DECLARED GAP, because the mutation says so. The script composes both outputs in
// a private `mktemp -d` and `mv`s them into place, so a symlink re-planted at a
// target between the `rm -f` and the write is REPLACED rather than written through.
// The tests in the next block all plant their symlink BEFORE the run, which the
// `rm -f` alone already defeats — swapping the `mv` for a `cp` leaves them green.
//
// The difference only shows in the window between the unlink and the write, and
// nothing here can hold that window open to step into it. So this is stated rather
// than claimed: `mv` is the mitigation, the test covers the planted-in-advance case,
// and the race itself is argued from rename(2)'s semantics, not demonstrated.
describe('stamp-diff-hash.sh — a planted path is not followed', { timeout: 35_000 }, () => {
  it('does not write into a symlinked .antagonistic-review directory', async () => {
    // Tracing the threat all the way. The leaf paths were protected and the
    // DIRECTORY was not — and the panelist is told to create that directory, so a
    // symlink there is the cheapest version of the attack: `mkdir -p` follows one
    // silently, and everything careful below then writes inside a directory of the
    // planter's choosing while every leaf-level assertion still passes.
    const { dir, work, base, head } = await repoFixture();
    try {
      const realOut = join(dir, 'out');
      const elsewhere = join(dir, 'attacker-dir');
      const diffPath = join(dir, 'review.diff');
      await mkdir(elsewhere, { recursive: true });
      await symlink(elsewhere, realOut);

      const result = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, realOut, diffPath);

      expect(result.code).toBe(0);
      // The key landed in a real directory at the path, not through the link.
      expect((await lstat(realOut)).isSymbolicLink()).toBe(false);
      expect(existsSync(join(realOut, 'diff-hash.txt'))).toBe(true);
      expect(existsSync(join(elsewhere, 'diff-hash.txt'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not write the hash through a symlink left at diff-hash.txt', async () => {
    // The OTHER path the header promises to protect, and the one that matters more:
    // diff-hash.txt is the memory key the panel reads back, so a write through a
    // link there aims the key at a file of the planter's choosing. Only the diff
    // path was covered — the same one-of-two asymmetry these scripts keep producing.
    const { dir, work, base, head } = await repoFixture();
    try {
      const outDir = join(dir, 'out');
      const diffPath = join(dir, 'review.diff');
      const decoy = join(dir, 'hash-decoy.txt');
      await mkdir(outDir, { recursive: true });
      await writeFile(decoy, 'ORIGINAL\n');
      await symlink(decoy, join(outDir, 'diff-hash.txt'));

      const result = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, outDir, diffPath);

      expect(result.code).toBe(0);
      expect(await readFile(decoy, 'utf8')).toBe('ORIGINAL\n');
      expect((await lstat(join(outDir, 'diff-hash.txt'))).isSymbolicLink()).toBe(false);
      // And a real key landed, so the assertion above cannot pass by the script
      // simply declining to write.
      expect((await readFile(join(outDir, 'diff-hash.txt'), 'utf8')).trim()).toMatch(
        /^[0-9a-f]{64}$/
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not write the reviewed diff through a symlink left at its path', async () => {
    // The threat this closes. The diff path is fixed and predictable, and the
    // panelist that runs immediately before this step holds Bash and Write — so a
    // symlink planted there would have `>` write the reviewed diff to a
    // destination of the planter's choosing, and the refuter downstream would
    // accept quotes from a file this step did not author.
    //
    // Asserted on the LINK TARGET, not on the exit code: the script exits 0 and
    // produces a correct hash either way, so only "the target was never touched"
    // shows the `rm -f` ran. Same class the workflow strips symlinks for when it
    // materialises the PR head.
    const { dir, work, base, head } = await repoFixture();
    try {
      const outDir = join(dir, 'out');
      const diffPath = join(dir, 'review.diff');
      const decoy = join(dir, 'decoy.txt');
      await mkdir(outDir, { recursive: true });
      await writeFile(decoy, 'ORIGINAL\n');
      await symlink(decoy, diffPath);

      const result = await stamp(work, { BASE_SHA: base, HEAD_SHA: head }, outDir, diffPath);

      expect(result.code).toBe(0);
      expect(await readFile(decoy, 'utf8')).toBe('ORIGINAL\n');
      // And the diff really was written — to a regular file at the path, not
      // skipped altogether, which would pass the assertion above vacuously.
      expect((await lstat(diffPath)).isSymbolicLink()).toBe(false);
      expect((await readFile(diffPath, 'utf8')).length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('stamp-diff-hash.sh — degraded tool availability', { timeout: 35_000 }, () => {
  // ─── sha256sum failure branch ─────────────────────────────────────────────

  it('treats an EMPTY hash as a failure too, not just a non-zero sha256sum', async () => {
    // The guard is `if ! hash_value="$(...)" || [ -z "$hash_value" ]`, which is two
    // independent ways in. The sibling test stubs sha256sum to exit 1, tripping the
    // first arm — and bash short-circuits `||`, so the emptiness check was never
    // evaluated by any test and could have been deleted with the suite green.
    //
    // A tool that exits 0 and prints nothing is the realistic shape of this: a
    // truncated write, a wrapper swallowing output. Without the second arm the
    // script would write an EMPTY diff-hash.txt and call it a key.
    const { dir, work, base, head } = await repoFixture();
    const stubBin = await mkdtemp(join(tmpdir(), 'stub-bin-emptyhash-'));
    try {
      const outDir = join(dir, 'out');
      const diffPath = join(dir, 'review.diff');
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');
      // Exits 0, prints nothing — the case the first arm cannot catch.
      await writeFile(join(stubBin, 'sha256sum'), '#!/usr/bin/env bash\nexit 0\n');
      await chmod(join(stubBin, 'sha256sum'), 0o755);

      const result = await stamp(
        work,
        {
          BASE_SHA: base,
          HEAD_SHA: head,
          PATH: `${stubBin}:${process.env['PATH'] ?? ''}`,
        },
        outDir,
        diffPath
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/could not hash the reviewed diff/);
      expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
    } finally {
      await rm(stubBin, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 0, prints the hash-failure reason, and removes any pre-existing diff-hash.txt when sha256sum fails', async () => {
    // Without this test the entire `if ! hash_value=…` branch could be deleted
    // and the suite would stay green: every existing test supplies a real sha256sum
    // so the branch never fires. The load-bearing assertion is the file-absence
    // check: a panelist writes diff-hash.txt before this script runs; if the
    // script exits early without removing it that value is uploaded as the
    // authentic hash — which is exactly the attack the clearing guarantee exists
    // to prevent. Exit-0 alone would pass with the branch deleted; file absence
    // is what pins the clearing promise on this path.
    const { dir, work, base, head } = await repoFixture();
    const stubBin = await mkdtemp(join(tmpdir(), 'stub-bin-sha256-'));
    try {
      // A sha256sum stub that prints nothing and exits 1.
      const stubSha256 = join(stubBin, 'sha256sum');
      await writeFile(stubSha256, '#!/usr/bin/env bash\nexit 1\n');
      await chmod(stubSha256, 0o755);

      const outDir = join(dir, 'out');
      const diffPath = join(dir, 'review.diff');
      await mkdir(outDir, { recursive: true });
      // Pre-seed an attacker-chosen value — it must be gone after the run.
      await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

      // Prepend the stub bin so our broken sha256sum shadows the real one,
      // while everything else (git, bash, cut …) still resolves normally.
      const result = await stamp(
        work,
        {
          BASE_SHA: base,
          HEAD_SHA: head,
          PATH: `${stubBin}:${process.env['PATH'] ?? ''}`,
        },
        outDir,
        diffPath
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('could not hash the reviewed diff');
      // The file must have been cleared before the hash guard fired.
      expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
    } finally {
      await rm(stubBin, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ─── timeout-absent fallback branch ──────────────────────────────────────

  it('contributes no key at all when there is no bounded timeout available', async (ctx) => {
    // The branch, and the trade it encodes. An earlier shape fell back to a bare
    // `git diff` here so a machine without coreutils could still stamp — which
    // swapped a fast, bounded failure for an UNBOUNDED call, on exactly the hosts
    // where no job timer is watching. Every other branch in this script degrades to
    // "this lens contributes no key"; an unbounded diff is the one degradation that
    // can hang instead of degrading.
    //
    // So the assertion is that NOTHING is written: exit 0, no hash file, and a
    // legible reason. A test that only checked the exit code would pass against the
    // unbounded fallback too, which is the shape this replaces.
    const { dir, work, base, head } = await repoFixture();
    const stubBin = await mkdtemp(join(tmpdir(), 'stub-bin-notimeout-'));
    try {
      // PATH is REPLACED, not prepended: `command -v timeout` has to genuinely
      // fail, and a prepended directory cannot hide a binary further along. So
      // everything the script shells out to has to be in the stub — bash included,
      // since execFile('bash', …) resolves through the same PATH — or it dies at
      // 127 or ENOENT, which reads exactly like the branch under test being broken.
      const requiredBinaries = [
        'bash',
        'git',
        'sha256sum',
        'cut',
        'mkdir',
        'mktemp',
        'mv',
        'rm',
        'tr',
      ] as const;
      for (const bin of requiredBinaries) {
        let resolved = '';
        try {
          const { stdout } = await run('which', [bin], { env: GIT_ENV, timeout: 5_000 });
          resolved = stdout.trim();
        } catch {
          resolved = '';
        }
        if (!resolved) {
          ctx.skip(); // legible skip: a binary the script needs is missing here
          return;
        }
        await symlink(resolved, join(stubBin, bin));
      }

      const outDir = join(dir, 'out');
      const diffPath = join(dir, 'review.diff');
      await mkdir(outDir, { recursive: true });
      // A hash a panelist could have planted: the degradation must clear it, not
      // merely decline to overwrite it.
      await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

      const result = await stamp(
        work,
        { BASE_SHA: base, HEAD_SHA: head, PATH: stubBin },
        outDir,
        diffPath
      );

      expect(result.code).toBe(0);
      expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
      expect(result.stdout).toMatch(/no bounded timeout available/);
    } finally {
      await rm(stubBin, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a non-numeric bound rather than interpolating it into the command', async () => {
    // DIFF_TIMEOUT_SECONDS exists so a test can drive the bound, which means it is
    // an input and gets an input's treatment: it lands on a command line, so it is
    // validated as digits before it goes anywhere. Added in the same change as the
    // env override and, until this test, unexercised — the branch could have been
    // deleted with everything else green.
    const { dir, work, base, head } = await repoFixture();
    try {
      const outDir = join(dir, 'out');
      const diffPath = join(dir, 'review.diff');
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

      const result = await stamp(
        work,
        { BASE_SHA: base, HEAD_SHA: head, DIFF_TIMEOUT_SECONDS: '60; touch /tmp/pwned' },
        outDir,
        diffPath
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/DIFF_TIMEOUT_SECONDS is not a positive whole number/);
      expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a bound of zero, which coreutils reads as no bound at all', async () => {
    // The value a digits-only check waves straight through, and the only one that
    // silently removes the guarantee the branch exists to give: `timeout 0 cmd` is
    // documented as "no time limit" and GNU coreutils runs it unbounded. A reader
    // scanning the config would see a number and move on.
    //
    // '00' is checked with it — the same hole spelled differently, and refused by
    // the same leading-zero clause rather than by a second rule.
    for (const bound of ['0', '00']) {
      const { dir, work, base, head } = await repoFixture();
      try {
        const outDir = join(dir, 'out');
        const diffPath = join(dir, 'review.diff');
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'diff-hash.txt'), 'attacker-chosen-value\n');

        const result = await stamp(
          work,
          { BASE_SHA: base, HEAD_SHA: head, DIFF_TIMEOUT_SECONDS: bound },
          outDir,
          diffPath
        );

        expect(result.code, `bound ${bound}`).toBe(0);
        expect(result.stdout, `bound ${bound}`).toMatch(
          /DIFF_TIMEOUT_SECONDS is not a positive whole number/
        );
        expect(existsSync(join(outDir, 'diff-hash.txt')), `bound ${bound}`).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('kills a hanging git diff at the bound and degrades rather than hanging', async () => {
    // Fault injection on the bound itself. Everything else here proves the script
    // handles a diff that FAILS; nothing proved the timeout actually fires on one
    // that never returns — the failure mode the bound exists for, and the one that
    // costs a whole job rather than one lens.
    //
    // `git` is stubbed to sleep well past a deliberately tiny bound, so the
    // assertion is about wall-clock as well as outcome: the script must come back
    // in far less than the sleep, having written no key.
    const { dir, work, base, head } = await repoFixture();
    const stubBin = await mkdtemp(join(tmpdir(), 'stub-bin-hang-'));
    try {
      const outDir = join(dir, 'out');
      const diffPath = join(dir, 'review.diff');
      await mkdir(outDir, { recursive: true });
      await writeFile(join(stubBin, 'git'), '#!/usr/bin/env bash\nsleep 30\n');
      await chmod(join(stubBin, 'git'), 0o755);

      const startedAt = process.hrtime.bigint();
      const result = await stamp(
        work,
        {
          BASE_SHA: base,
          HEAD_SHA: head,
          // Prepended, not replacing: `timeout` must still resolve — it is the
          // mechanism under test — while `git` resolves to the stub.
          PATH: `${stubBin}:${process.env['PATH'] ?? ''}`,
          DIFF_TIMEOUT_SECONDS: '1',
        },
        outDir,
        diffPath
      );
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

      expect(result.code).toBe(0);
      expect(existsSync(join(outDir, 'diff-hash.txt'))).toBe(false);
      expect(result.stdout).toMatch(/could not materialise the reviewed diff/);
      // Generous against a loaded machine, and still an order of magnitude below
      // the stub's sleep — so it can only pass if the bound actually fired.
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await rm(stubBin, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
