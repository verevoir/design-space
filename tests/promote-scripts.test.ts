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
});
