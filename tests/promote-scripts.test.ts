import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The promotion's shell steps, driven against STUB `gcloud`, `gh` and real throwaway git
// repositories — each outcome produced rather than simulated. These paths run during an
// incident, on a day nobody planned for, so "it looked right" is not evidence.

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/promote');
const TRAFFIC_SNAPSHOT_CLI = resolve(SCRIPTS, 'traffic-snapshot.mjs');

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A stub executable named `name` that prints `output` and exits `code`. */
async function stub(name: string, output: string, code: number): Promise<string> {
  const dir = await tmp(`ds-${name}-stub-`);
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\ncat <<'STUBEOF'\n${output}\nSTUBEOF\nexit ${code}\n`, 'utf-8');
  await chmod(path, 0o755);
  return dir;
}

/** A stub that writes `stdout` on fd1 and `stderr` on fd2 separately, then exits `code`. Used
 * to prove a script parses only the stdout channel — stderr chatter on an otherwise-successful
 * call must not corrupt an exact parse or comparison. */
async function stubWithStderr(name: string, stdout: string, stderr: string, code: number): Promise<string> {
  const dir = await tmp(`ds-${name}-stubse-`);
  const path = join(dir, name);
  await writeFile(
    path,
    `#!/bin/sh\ncat <<'STUBEOF'\n${stdout}\nSTUBEOF\ncat <<'STUBEOF' >&2\n${stderr}\nSTUBEOF\nexit ${code}\n`,
    'utf-8',
  );
  await chmod(path, 0o755);
  return dir;
}

/** A stub that records the arguments it was called with, one call per line. */
async function recordingStub(name: string, output: string, code: number): Promise<{ dir: string; log: string }> {
  const dir = await tmp(`ds-${name}-rec-`);
  const log = join(dir, 'calls.log');
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\necho "$@" >> "${log}"\ncat <<'STUBEOF'\n${output}\nSTUBEOF\nexit ${code}\n`, 'utf-8');
  await chmod(path, 0o755);
  return { dir, log };
}

function run(script: string, args: string[], pathPrefix?: string, env: Record<string, string> = {}) {
  const res = spawnSync('bash', [join(SCRIPTS, script), ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...env,
      PATH: pathPrefix ? `${pathPrefix}:${process.env['PATH'] ?? ''}` : (process.env['PATH'] ?? ''),
    },
  });
  return { code: res.status ?? 1, out: res.stdout ?? '', err: res.stderr ?? '' };
}

function git(cwd: string, ...args: string[]) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  return (res.stdout ?? '').trim();
}

/** A repository with one commit on main; returns its path. */
async function repoWithCommit(): Promise<string> {
  const dir = await tmp('ds-git-');
  git(dir, 'init', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  await writeFile(join(dir, 'a.txt'), 'one\n', 'utf-8');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'first');
  return dir;
}

function runIn(cwd: string, script: string, args: string[]) {
  const res = spawnSync('bash', [join(SCRIPTS, script), ...args], { cwd, encoding: 'utf-8' });
  return { code: res.status ?? 1, out: res.stdout ?? '', err: res.stderr ?? '' };
}

/** Runs traffic-snapshot.mjs's own CLI entry point directly — no shell wrapper sits between
 * this and its argument validation, so this is the only way to reach those branches at all. */
function runTrafficSnapshotCli(args: string[], stdin: string) {
  const res = spawnSync('node', [TRAFFIC_SNAPSHOT_CLI, ...args], { input: stdin, encoding: 'utf-8' });
  return { code: res.status ?? 1, out: res.stdout ?? '', err: res.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// assert-ancestry.sh
// ---------------------------------------------------------------------------

describe('assert-ancestry.sh', () => {
  it('passes when the base is an ancestor of the head', async () => {
    const dir = await repoWithCommit();
    const base = git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, 'b.txt'), 'two\n', 'utf-8');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'second');

    const r = runIn(dir, 'assert-ancestry.sh', [base, 'HEAD']);

    expect(r.code).toBe(0);
  });

  it('fails when the branch is behind its base', async () => {
    // The case the whole ordering rests on: a branch that is not up to date can be squashed
    // into a tree that is not the tree that was canaried.
    const dir = await repoWithCommit();
    const first = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-b', 'side', first);
    await writeFile(join(dir, 'side.txt'), 'side\n', 'utf-8');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'side');
    const side = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', 'main');
    await writeFile(join(dir, 'main.txt'), 'main\n', 'utf-8');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'moved on');

    const r = runIn(dir, 'assert-ancestry.sh', ['main', side]);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('not an ancestor');
  });

  it('reports an unresolvable ref as itself, not as an out-of-date branch', async () => {
    // Otherwise a shallow checkout reads as "your branch is behind" and sends someone rebasing
    // a branch that was never behind anything.
    const dir = await repoWithCommit();

    const r = runIn(dir, 'assert-ancestry.sh', ['main', 'no-such-ref']);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain("cannot resolve ref 'no-such-ref'");
    expect(r.err).not.toContain('not an ancestor');
  });
});

// ---------------------------------------------------------------------------
// assert-tree-equal.sh
// ---------------------------------------------------------------------------

describe('assert-tree-equal.sh', () => {
  it('passes when two different commits carry the same tree', async () => {
    // Exactly the squash case: a new commit SHA over identical content.
    const dir = await repoWithCommit();
    const first = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'commit', '--allow-empty', '-m', 'same tree, new sha');
    const second = git(dir, 'rev-parse', 'HEAD');

    expect(first).not.toBe(second);
    expect(runIn(dir, 'assert-tree-equal.sh', [first, second]).code).toBe(0);
  });

  it('fails, loudly and with both trees named, when the content differs', async () => {
    const dir = await repoWithCommit();
    const first = git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, 'c.txt'), 'three\n', 'utf-8');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'different');
    const second = git(dir, 'rev-parse', 'HEAD');

    const r = runIn(dir, 'assert-tree-equal.sh', [first, second]);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('OPERATOR INTERVENTION REQUIRED');
  });

  it('says that traffic has been left on the canaried revision', async () => {
    // The ruling: fail loudly, leave traffic on the proven artefact, retag nothing, require a
    // human. A message that did not say so would leave an operator guessing at live state.
    const dir = await repoWithCommit();
    const first = git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, 'c.txt'), 'three\n', 'utf-8');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'different');

    const r = runIn(dir, 'assert-tree-equal.sh', [first, git(dir, 'rev-parse', 'HEAD')]);

    expect(r.err).toContain('has been left serving');
    expect(r.err).toContain('was NOT retagged');
  });

  it('fails rather than comparing nothing when a ref cannot be resolved', async () => {
    // The subtle one: an `exit` inside the command substitution would only leave the subshell,
    // and the caller would compare "" to "" and report a match.
    const dir = await repoWithCommit();

    const r = runIn(dir, 'assert-tree-equal.sh', ['HEAD', 'no-such-ref']);

    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('identical');
  });

  it('fails rather than reporting a match when NEITHER ref resolves', async () => {
    // The hole the single-bad-ref case above does not reach. If resolve_tree can report a
    // failure without failing its caller, BOTH trees are the empty string, "" equals "", and
    // the script announces an identical tree it never compared — a green promotion built on a
    // comparison that never happened.
    const dir = await repoWithCommit();

    const r = runIn(dir, 'assert-tree-equal.sh', ['no-such-ref', 'also-missing']);

    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('identical');
    expect(r.err).toContain('cannot resolve');
  });
});

// ---------------------------------------------------------------------------
// retag.sh
// ---------------------------------------------------------------------------

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('retag.sh', () => {
  it('tags the digest under the new name', async () => {
    const { dir, log } = await recordingStub('gcloud', 'Created tag.', 0);
    const r = run('retag.sh', ['repo/img', DIGEST, 'abc123'], dir);

    expect(r.code).toBe(0);
    expect(await readFile(log, 'utf-8')).toContain(`repo/img@${DIGEST} repo/img:abc123`);
  });

  it('REFUSES a mutable tag as the source', async () => {
    // "Retag whatever that tag points at" races anything else that moves it, so the artefact
    // that ships would not provably be the artefact that was proven — artefact-identity.
    const { dir, log } = await recordingStub('gcloud', 'Created tag.', 0);
    const r = run('retag.sh', ['repo/img', 'latest', 'abc123'], dir);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('is not a sha256 digest');
    // And it must not have called gcloud at all.
    await expect(readFile(log, 'utf-8')).rejects.toThrow();
  });

  it('refuses a truncated digest', async () => {
    const dir = await stub('gcloud', 'Created tag.', 0);

    expect(run('retag.sh', ['repo/img', 'sha256:abc', 'abc123'], dir).code).not.toBe(0);
  });

  it('fails when gcloud fails, rather than claiming the tag exists', async () => {
    const dir = await stub('gcloud', 'ERROR: PERMISSION_DENIED', 1);
    const r = run('retag.sh', ['repo/img', DIGEST, 'abc123'], dir);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('does not name the proven digest');
  });
});

// ---------------------------------------------------------------------------
// shift-traffic.sh
// ---------------------------------------------------------------------------

describe('shift-traffic.sh', () => {
  it('shifts to the named revision by name, not by tag', async () => {
    // By name, so the assignment still says what it means after the candidate tag is dropped.
    const { dir, log } = await recordingStub('gcloud', 'Traffic updated.', 0);
    const r = run('shift-traffic.sh', ['svc', 'eu', 'rev-7', '10'], dir);

    expect(r.code).toBe(0);
    expect(await readFile(log, 'utf-8')).toContain('--to-revisions rev-7=10');
  });

  it('is idempotent: the same call twice is the same end state', async () => {
    const { dir, log } = await recordingStub('gcloud', 'Traffic updated.', 0);
    run('shift-traffic.sh', ['svc', 'eu', 'rev-7', '100'], dir);
    run('shift-traffic.sh', ['svc', 'eu', 'rev-7', '100'], dir);
    const calls = (await readFile(log, 'utf-8')).trim().split('\n');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
  });

  it('rejects a percentage outside 0-100 before calling gcloud', async () => {
    const dir = await stub('gcloud', 'Traffic updated.', 0);

    expect(run('shift-traffic.sh', ['svc', 'eu', 'rev-7', '110'], dir).code).not.toBe(0);
    expect(run('shift-traffic.sh', ['svc', 'eu', 'rev-7', 'ten'], dir).code).not.toBe(0);
  });

  it('fails when gcloud fails, naming the split it may have left', async () => {
    const dir = await stub('gcloud', 'ERROR: quota exceeded', 1);
    const r = run('shift-traffic.sh', ['svc', 'eu', 'rev-7', '10'], dir);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('traffic may be split');
  });
});

// ---------------------------------------------------------------------------
// capture-traffic.sh and rollback.sh
// ---------------------------------------------------------------------------

const DESCRIBE = JSON.stringify({
  status: {
    latestReadyRevisionName: 'rev-3',
    traffic: [
      { revisionName: 'rev-2', percent: 100 },
      { revisionName: 'rev-3', percent: 0, tag: 'candidate' },
    ],
  },
});

describe('capture-traffic.sh', () => {
  it('writes a restore point naming the revision that carries traffic', async () => {
    const dir = await stub('gcloud', DESCRIBE, 0);
    const out = join(await tmp('ds-snap-'), 'snap.json');
    const r = run('capture-traffic.sh', ['svc', 'eu', out], dir);

    expect(r.code).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf-8')).assignments).toEqual([{ revision: 'rev-2', percent: 100 }]);
  });

  it('refuses to start a promotion when the service cannot be described', async () => {
    // Beginning without a rollback target is how a failure becomes an incident.
    const dir = await stub('gcloud', 'ERROR: PERMISSION_DENIED', 1);
    const out = join(await tmp('ds-snap-'), 'snap.json');
    const r = run('capture-traffic.sh', ['svc', 'eu', out], dir);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('no rollback target');
  });

  it('leaves no snapshot file behind when the state could not be captured', async () => {
    // A half-written file would be read later as a valid restore point.
    const dir = await stub('gcloud', JSON.stringify({ status: { traffic: [{ revisionName: 'a', percent: 60 }] } }), 0);
    const out = join(await tmp('ds-snap-'), 'snap.json');
    const r = run('capture-traffic.sh', ['svc', 'eu', out], dir);

    expect(r.code).not.toBe(0);
    await expect(readFile(out, 'utf-8')).rejects.toThrow();
  });

  it('still parses the describe output when gcloud writes chatter to stderr on an otherwise-successful call', async () => {
    // Merging stderr into the JSON that gets parsed (2>&1) would corrupt it. This proves the
    // parse survives real-world chatter — e.g. "Updated property [core/project]" — on stderr.
    const dir = await stubWithStderr('gcloud', DESCRIBE, 'Updated property [core/project].', 0);
    const out = join(await tmp('ds-snap-'), 'snap.json');
    const r = run('capture-traffic.sh', ['svc', 'eu', out], dir);

    expect(r.code).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf-8')).assignments).toEqual([{ revision: 'rev-2', percent: 100 }]);
  });
});

describe('rollback.sh', () => {
  async function snapshotFile(): Promise<string> {
    const path = join(await tmp('ds-snap-'), 'snap.json');
    await writeFile(
      path,
      JSON.stringify({ service: 'svc', region: 'eu', assignments: [{ revision: 'rev-2', percent: 100 }], tags: ['candidate'] }),
      'utf-8',
    );
    return path;
  }

  it('restores traffic to the captured assignment', async () => {
    const { dir, log } = await recordingStub('gcloud', 'Traffic updated.', 0);
    const r = run('rollback.sh', [await snapshotFile(), 'candidate'], dir);

    expect(r.code).toBe(0);
    expect(await readFile(log, 'utf-8')).toContain('--to-revisions rev-2=100');
  });

  it('removes the candidate tag as well as restoring traffic', async () => {
    const { dir, log } = await recordingStub('gcloud', 'Traffic updated.', 0);
    run('rollback.sh', [await snapshotFile(), 'candidate'], dir);

    expect(await readFile(log, 'utf-8')).toContain('--remove-tags candidate');
  });

  it('never rebuilds — recovery is one API call', async () => {
    const { dir, log } = await recordingStub('gcloud', 'Traffic updated.', 0);
    run('rollback.sh', [await snapshotFile(), 'candidate'], dir);
    const calls = await readFile(log, 'utf-8');

    expect(calls).not.toContain('run deploy');
    expect(calls).not.toContain('builds submit');
  });

  it('records the deployment as failed', async () => {
    const dir = (await recordingStub('gcloud', 'Traffic updated.', 0)).dir;
    const r = run('rollback.sh', [await snapshotFile(), 'candidate'], dir);

    expect(r.out).toContain('Deployment rolled back');
  });

  it('fails loudly when there is no restore point rather than doing nothing', async () => {
    const dir = await stub('gcloud', 'Traffic updated.', 0);
    const r = run('rollback.sh', [join(await tmp('ds-none-'), 'missing.json'), 'candidate'], dir);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('must be restored by hand');
  });

  it('reports an incident when traffic could not be restored', async () => {
    const dir = await stub('gcloud', 'ERROR: PERMISSION_DENIED', 1);
    const r = run('rollback.sh', [await snapshotFile(), 'candidate'], dir);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('may be serving the failed candidate');
  });
});

// ---------------------------------------------------------------------------
// traffic-snapshot.mjs — CLI argument validation
// ---------------------------------------------------------------------------

// The parsing functions themselves (snapshotFromDescribe, restoreSpec, revisionForTag) are
// exercised as pure functions in tests/promote-decisions.test.ts. What is tested here is the
// two argument-validation branches that live only in this CLI entry point — neither call site
// (capture-traffic.sh, rollback.sh) ever exercises them, since both always pass complete,
// recognised flags.

describe('traffic-snapshot.mjs — CLI argument validation', () => {
  it('refuses --snapshot without both --service and --region', () => {
    const r = runTrafficSnapshotCli(['--snapshot', '--service', 'svc'], '{}');

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('--snapshot requires --service and --region');
  });

  it('refuses --snapshot with --region but no --service', () => {
    const r = runTrafficSnapshotCli(['--snapshot', '--region', 'eu'], '{}');

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('--snapshot requires --service and --region');
  });

  it('refuses when none of --snapshot, --restore-spec or --revision-for-tag is given', () => {
    // A typo'd or missing flag must not fall through and read stdin as some other operation.
    const r = runTrafficSnapshotCli(['--nonsense'], '{}');

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('expected one of --snapshot, --restore-spec, --revision-for-tag');
  });
});

// ---------------------------------------------------------------------------
// squash-merge.sh
// ---------------------------------------------------------------------------

describe('squash-merge.sh', () => {
  /** A `gh` stub that answers `pr view --json state` and `--json mergeCommit` differently. */
  async function ghStub(state: string, sha: string, mergeCode = 0): Promise<string> {
    const dir = await tmp('ds-gh-');
    const path = join(dir, 'gh');
    await writeFile(
      path,
      [
        '#!/bin/sh',
        'case "$*" in',
        `  *"--json state"*) echo "${state}" ;;`,
        `  *"--json mergeCommit"*) echo "${sha}" ;;`,
        `  *merge*) exit ${mergeCode} ;;`,
        '  *) echo "unexpected: $*" >&2; exit 9 ;;',
        'esac',
        'exit 0',
      ].join('\n'),
      'utf-8',
    );
    await chmod(path, 0o755);
    return dir;
  }

  it('merges an open PR and returns the merge commit', async () => {
    const r = run('squash-merge.sh', ['o/r', '7'], await ghStub('OPEN', 'deadbeef'));

    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('deadbeef');
  });

  it('treats an ALREADY-MERGED PR as success, reporting the existing commit', async () => {
    // Idempotency. A merge that succeeded and lost its answer to a timeout would, on retry,
    // fail with "not mergeable" — which reads as a broken promotion when it in fact worked.
    const r = run('squash-merge.sh', ['o/r', '7'], await ghStub('MERGED', 'cafebabe'));

    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('cafebabe');
  });

  it('refuses to merge a closed PR', async () => {
    const r = run('squash-merge.sh', ['o/r', '7'], await ghStub('CLOSED', ''));

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('is CLOSED, not OPEN');
  });

  it('fails when the merge itself fails', async () => {
    const r = run('squash-merge.sh', ['o/r', '7'], await ghStub('OPEN', 'deadbeef', 1));

    expect(r.code).not.toBe(0);
  });

  it('fails rather than returning an empty SHA when none is reported', async () => {
    // An empty MERGE_SHA downstream would make the tree-equality check compare against nothing.
    const r = run('squash-merge.sh', ['o/r', '7'], await ghStub('MERGED', ''));

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('names no merge commit');
  });

  it('still recognises MERGED exactly when gh writes chatter to stderr on an otherwise-successful call', async () => {
    // Merging stderr into STATE (2>&1) would corrupt the exact comparison against "MERGED", and
    // a perfectly-merged PR would be refused as neither MERGED nor OPEN, for the wrong reason.
    const dir = await tmp('ds-gh-chatter-');
    const path = join(dir, 'gh');
    await writeFile(
      path,
      [
        '#!/bin/sh',
        'case "$*" in',
        '  *"--json state"*) echo "MERGED"; echo "Warning: chatter on an otherwise-successful call" >&2 ;;',
        '  *"--json mergeCommit"*) echo "cafebabe" ;;',
        '  *) echo "unexpected: $*" >&2; exit 9 ;;',
        'esac',
        'exit 0',
      ].join('\n'),
      'utf-8',
    );
    await chmod(path, 0o755);

    const r = run('squash-merge.sh', ['o/r', '7'], dir);

    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('cafebabe');
  });
});

// ---------------------------------------------------------------------------
// wait-for-green.sh
// ---------------------------------------------------------------------------

// The verdict itself is checks-green.mjs, tested as a pure function elsewhere. What is tested
// here is the wrapper's own three error paths, each of which decides whether a promotion stops:
// a page it cannot see past, an API it could not read, and a bound it reached. All three run
// only during a failure, which is precisely when nobody is watching them for the first time.

describe('wait-for-green.sh', () => {
  const NOW = { WAIT_FOR_GREEN_TIMEOUT: '0', WAIT_FOR_GREEN_INTERVAL: '1' };

  const check = (name: string, status: string, conclusion: string | null) => ({ name, status, conclusion });

  it('refuses to judge a commit carrying more checks than it can read in one page', async () => {
    // The guard's own comment says the verdict would become wrong SILENTLY. A subset that
    // happens to be green reads exactly like a green suite, so the count is asserted rather
    // than assumed — note this payload's visible check IS green, so nothing but the guard
    // stands between it and a promotion.
    const body = JSON.stringify({ total_count: 101, check_runs: [check('ci', 'completed', 'success')] });
    const dir = await stub('gh', body, 0);

    const r = run('wait-for-green.sh', ['o/r', 'abc123', 'promote'], dir, NOW);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('exceeds the single page');
  });

  it('stops when the checks cannot be read, rather than treating an unreadable API as pending', async () => {
    // An API error is not "no checks failed yet". Waiting it out would burn the bound and then
    // report a timeout, naming the wrong cause to whoever reads it.
    const dir = await stub('gh', 'gh: HTTP 502 Bad Gateway', 1);

    const r = run('wait-for-green.sh', ['o/r', 'abc123', 'promote'], dir, NOW);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('could not read the checks for abc123');
    expect(r.err).toContain('502');
  });

  it('fails when the bound is reached, rather than waiting forever or reporting green', async () => {
    // A pending suite that never finishes is the case the bound exists for, and the exit status
    // must be the failing one: a promotion that treated "ran out of time" as "good enough"
    // would merge a commit whose review never finished.
    const body = JSON.stringify({
      total_count: 2,
      check_runs: [check('ci', 'in_progress', null), check('promote', 'in_progress', null)],
    });
    const dir = await stub('gh', body, 0);

    const r = run('wait-for-green.sh', ['o/r', 'abc123', 'promote'], dir, NOW);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('did not go green within 0s');
    expect(r.err).toContain('waiting on: ci');
  });

  it('still parses the checks payload when gh writes chatter to stderr on an otherwise-successful call', async () => {
    // Merging stderr into BODY (2>&1) would corrupt the JSON parse, silently blocking a healthy
    // promotion on chatter — e.g. a rate-limit notice — that was never part of the answer.
    const body = JSON.stringify({ total_count: 1, check_runs: [check('ci', 'completed', 'success')] });
    const dir = await stubWithStderr('gh', body, 'Warning: rate limit low', 0);

    const r = run('wait-for-green.sh', ['o/r', 'abc123', 'promote'], dir, NOW);

    expect(r.code).toBe(0);
  });
});
