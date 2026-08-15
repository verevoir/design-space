import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shape regression tests for promote.yml, in the same text-shape style as the ci and preview
// suites. This workflow moves production traffic and merges to main, so the properties pinned
// here are the ones whose quiet removal would be most expensive: the digest pin, the traffic
// proportions, the audience, the fork guard, the timeouts, and the rollback's two conditions.
//
// bash -n over every run: block is NOT repeated here — preview-workflow-shape.test.ts already
// parses every workflow file in the directory, this one included.

const yml = readFileSync(
  fileURLToPath(new URL('../.github/workflows/promote.yml', import.meta.url)),
  'utf8',
);
const flat = yml.replace(/\s+/g, ' ');

/** Every step block in the promote job, split on the six-space step boundary. */
function steps(): string[] {
  return yml
    .split(/\n      - /)
    .slice(1)
    .map((s) => `      - ${s}`);
}

/** The block for the step whose name (or structural marker) contains `marker`. */
function stepContaining(marker: string): string {
  const found = steps().find((s) => s.includes(marker));
  return found ?? '';
}

const GUARD = 'github.event.pull_request.head.repo.full_name == github.repository';

// ---------------------------------------------------------------------------
// Serialisation — traffic is global state
// ---------------------------------------------------------------------------

describe('promote.yml — promotions are serialised, never cancelled', () => {
  it('declares a concurrency group that is not per-PR', () => {
    // Per-PR would let two PRs promote at once, and traffic is not per-PR state: the second
    // would capture a restore point that already contained the first's candidate.
    expect(flat).toMatch(/group: promote-\$\{\{ github\.repository \}\}/);
    expect(flat).not.toMatch(/group: promote-\$\{\{ github\.event\.pull_request\.number/);
  });

  it('sets cancel-in-progress: false', () => {
    // A cancelled promotion leaves traffic split with nothing scheduled to finish or undo it.
    expect(flat).toMatch(/concurrency:.*group: promote-.*cancel-in-progress: false/);
  });
});

// ---------------------------------------------------------------------------
// Timeouts — every job and every step
// ---------------------------------------------------------------------------

describe('promote.yml — everything is time-bounded', () => {
  it('bounds the job', () => {
    expect(yml).toMatch(/\n    timeout-minutes: \d+/);
  });

  it('bounds EVERY step, with none left to the six-hour repository ceiling', () => {
    // ADR 0007: an unbounded promotion step is worse than a failed one, because it leaves
    // traffic in a split state with nobody watching. Enumerating steps by name is how a gap
    // like this survives, so this counts them instead.
    const unbounded = steps()
      .filter((s) => !/timeout-minutes: \d+/.test(s))
      .map((s) => {
        const m = /name: (.+)/.exec(s);
        return m ? m[1]!.trim() : s.slice(0, 60).replace(/\n/g, ' ');
      });

    expect(unbounded).toEqual([]);
  });

  it('has at least as many timeouts as steps, so none borrows another one', () => {
    const timeouts = yml.match(/timeout-minutes: \d+/g) ?? [];

    // One per step plus the job's own.
    expect(timeouts.length).toBeGreaterThanOrEqual(steps().length + 1);
  });
});

// ---------------------------------------------------------------------------
// artefact-identity — the deploy is pinned to a digest
// ---------------------------------------------------------------------------

describe('promote.yml — the deployed artefact is pinned by digest', () => {
  it('deploys the digest-pinned image, never a mutable tag', () => {
    const deploy = stepContaining('Deploy the candidate revision');

    expect(deploy).toContain('--image      "$IMAGE_PINNED"');
    // A tag is a mutable pointer; deploying one means the artefact that ships is not provably
    // the artefact that was proven.
    expect(deploy).not.toMatch(/--image\s+"\$IMAGE_TAGGED"/);
  });

  it('builds IMAGE_PINNED from the repo and a digest, with an @', () => {
    expect(yml).toMatch(/IMAGE_PINNED=\$\{\{ env\.IMAGE_REPO \}\}@\$\{DIGEST\}/);
  });

  it('fails the run when no digest could be resolved rather than continuing', () => {
    const resolve = stepContaining('Resolve the image digest');

    expect(resolve).toMatch(/if \[ -z "\$DIGEST" \]/);
    expect(resolve).toContain('exit 1');
  });

  it('retags from the digest, so the promoted image is the proven one', () => {
    const retag = stepContaining('Retag the proven image');

    expect(retag).toContain('retag.sh');
    expect(retag).toContain('$IMAGE_DIGEST');
  });
});

// ---------------------------------------------------------------------------
// deploy-safety — the staged cut, and only the staged cut ADR 0007 settled on
// ---------------------------------------------------------------------------

describe('promote.yml — the traffic cut is 10 then 100', () => {
  it('deploys the candidate carrying no traffic, under the candidate tag', () => {
    const deploy = stepContaining('Deploy the candidate revision');

    expect(deploy).toContain('--no-traffic');
    expect(deploy).toMatch(/--tag\s+"\$\{\{ env\.CANDIDATE_TAG \}\}"/);
  });

  it('shifts traffic in exactly the proportions ADR 0007 settled on', () => {
    // ADR 0007 argued with deploy-safety explicitly and won on the merits for this traffic
    // volume: 10 then 100, with no 25/50/75 steps. Equally, a 0 or a single 100 would remove
    // the one step in the sequence that observes real traffic on the new revision.
    const percents = [...flat.matchAll(/\$CANDIDATE_REVISION" (\d+)/g)].map((m) => Number(m[1]));

    // 10, then 100 for the cut, then 100 again when traffic is pinned before the tag is dropped.
    expect(percents).toEqual([10, 100, 100]);
  });

  it('smokes the candidate BEFORE any traffic moves', () => {
    const smokeIdx = yml.indexOf('Smoke the candidate while it carries no traffic');
    const cutIdx = yml.indexOf('Cut 10% of traffic');

    expect(smokeIdx).toBeGreaterThanOrEqual(0);
    expect(cutIdx).toBeGreaterThan(smokeIdx);
  });

  it('merges only after the full cut has succeeded', () => {
    const cut100 = yml.indexOf('Cut 100% of traffic');
    const merge = yml.indexOf('Squash-merge the pull request');

    expect(cut100).toBeGreaterThanOrEqual(0);
    expect(merge).toBeGreaterThan(cut100);
  });
});

// ---------------------------------------------------------------------------
// The health check probes the candidate tag, and knows which revision answered
// ---------------------------------------------------------------------------

describe('promote.yml — the health check reaches the candidate specifically', () => {
  it('probes the TAG url, not the blended service url', () => {
    // At a 10% split the service url lands most requests on the incumbent, which 404s /health,
    // so a failure there says nothing about the candidate. Recorded divergence from ADR 0007.
    const health = stepContaining('Health-check the candidate under live traffic');

    expect(health).toContain('smoke.sh "$TAG_URL"');
    expect(health).not.toContain('smoke.sh "$SERVICE_URL"');
  });

  it('pins the health check to the candidate revision', () => {
    // Without this the probe would pass against whatever answered, which at a split is usually
    // the incumbent — a green check that never reached the new build.
    const health = stepContaining('Health-check the candidate under live traffic');

    expect(health).toMatch(/SMOKE_EXPECT_REVISION: \$\{\{ env\.CANDIDATE_REVISION \}\}/);
  });

  it('never asks for /healthz, which Cloud Run intercepts', () => {
    expect(yml).not.toContain('/healthz');
  });
});

// ---------------------------------------------------------------------------
// Identity — WIF, the invoker, and no local --account
// ---------------------------------------------------------------------------

describe('promote.yml — how identity is established', () => {
  it('never hardcodes a local --account', () => {
    // --account is for a developer's machine, whose active account belongs to another org. In
    // CI the identity comes from google-github-actions/auth, and an --account here would be a
    // defect that reads like a permissions problem.
    expect(yml).not.toContain('--account=');
  });

  it('never mints an ID token with gcloud auth print-identity-token', () => {
    // WIF yields an EXTERNAL ACCOUNT credential, which that command rejects outright.
    expect(yml).not.toContain('print-identity-token');
  });

  it('mints the token through the auth action with token_format: id_token', () => {
    expect(flat).toMatch(/token_format: id_token/);
  });

  it('scopes the audience to the SERVICE url even though the request goes to the TAG url', () => {
    const mintIdx = yml.indexOf('token_format: id_token');
    const stepStart = yml.lastIndexOf('\n      - ', mintIdx);
    const nextStep = yml.indexOf('\n      - ', mintIdx + 1);
    const mint = yml.slice(stepStart, nextStep >= 0 ? nextStep : undefined);

    expect(mint).toMatch(/id_token_audience:.*SERVICE_URL/);
    expect(mint).not.toMatch(/id_token_audience:.*TAG_URL/);
  });

  it('mints the smoke token as the invoker, never the deployer', () => {
    const mintIdx = yml.indexOf('token_format: id_token');
    const stepStart = yml.lastIndexOf('\n      - ', mintIdx);
    const nextStep = yml.indexOf('\n      - ', mintIdx + 1);
    const mint = yml.slice(stepStart, nextStep >= 0 ? nextStep : undefined);

    expect(mint).toMatch(/service_account:\s*\$\{\{ env\.INVOKER_SA \}\}/);
    expect(mint).not.toMatch(/DEPLOYER_SA/);
  });

  it('masks the token before the first step that could echo it', () => {
    const mask = yml.indexOf('::add-mask::');
    const smoke = yml.indexOf('Smoke the candidate while it carries no traffic');

    expect(mask).toBeGreaterThanOrEqual(0);
    expect(mask).toBeLessThan(smoke);
  });

  it('passes the token by env:, never on a command line', () => {
    const smoke = stepContaining('Smoke the candidate while it carries no traffic');

    expect(smoke).toMatch(/env:[\s\S]*SMOKE_ID_TOKEN/);
    expect(smoke).not.toMatch(/smoke\.sh.*outputs\.id_token/);
  });
});

// ---------------------------------------------------------------------------
// Fork guard
// ---------------------------------------------------------------------------

describe('promote.yml — fork pull requests cannot promote', () => {
  it('carries the guard on every step except the checkout and the fork notice', () => {
    const inverse = 'github.event.pull_request.head.repo.full_name != github.repository';
    const unguarded = steps()
      .filter((s) => !s.includes(GUARD))
      .filter((s) => !s.includes('actions/checkout@'))
      .filter((s) => !s.includes(inverse))
      .map((s) => {
        const m = /name: (.+)/.exec(s);
        return m ? m[1]!.trim() : s.slice(0, 60).replace(/\n/g, ' ');
      });

    expect(unguarded).toEqual([]);
  });

  it('explains itself in the job summary rather than failing on an auth error', () => {
    const notice = stepContaining('Skip promotion for fork pull requests');

    expect(notice).toContain('GITHUB_STEP_SUMMARY');
  });
});

// ---------------------------------------------------------------------------
// The gate that decides whether the change is allowed to promote at all
// ---------------------------------------------------------------------------

describe('promote.yml — the green-checks gate', () => {
  it('waits for the other checks before anything is deployed', () => {
    const wait = yml.indexOf('Wait for every other check');
    const auth = yml.indexOf('Authenticate to Google Cloud');

    expect(wait).toBeGreaterThanOrEqual(0);
    expect(wait).toBeLessThan(auth);
  });

  it('excludes its own check, so the gate cannot wait on itself', () => {
    // This workflow is a check on the commit it promotes. Without the exclusion the wait can
    // never finish: the check it is waiting for is the run doing the waiting.
    const wait = stepContaining('Wait for every other check');

    expect(wait).toMatch(/\$\{\{ env\.SELF_CHECK_NAME \}\}/);
    expect(yml).toMatch(/SELF_CHECK_NAME: promote/);
  });

  it('names the job so the excluded check name is the one that actually appears', () => {
    // The exclusion matches on the check's name, which is the job's name. If they drift apart
    // the exclusion silently stops matching and the gate deadlocks.
    expect(yml).toMatch(/\n    name: promote\n/);
  });

  it('keeps the decision logic in a script, not in the run: block', () => {
    const wait = stepContaining('Wait for every other check');

    expect(wait).toContain('scripts/promote/wait-for-green.sh');
  });
});

// ---------------------------------------------------------------------------
// Ancestry, history depth, and the order of the sequence
// ---------------------------------------------------------------------------

describe('promote.yml — history is deep enough to answer the questions asked of it', () => {
  it('checks out full history', () => {
    // Ancestry and tree equality are both history questions. A shallow clone answers "not an
    // ancestor" for a branch that is perfectly up to date.
    expect(flat).toMatch(/fetch-depth: 0/);
  });

  it('checks out the PR head, not the merge commit', () => {
    // The tree being canaried must be the branch's tree; the default merge ref is a tree that
    // exists nowhere else and would fail the equality check after the squash.
    expect(flat).toMatch(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  });

  it('asserts ancestry before it authenticates or builds anything', () => {
    const ancestry = yml.indexOf('Assert the branch is up to date');
    const build = yml.indexOf('Build and push the image');

    expect(ancestry).toBeGreaterThanOrEqual(0);
    expect(ancestry).toBeLessThan(build);
  });

  it('runs the whole sequence in the order ADR 0007 sets out', () => {
    const order = [
      'Wait for every other check',
      'Assert the branch is up to date',
      'Authenticate to Google Cloud',
      'Capture the rollback target',
      'Build and push the image',
      'Deploy the candidate revision',
      'Smoke the candidate while it carries no traffic',
      'Cut 10% of traffic',
      'Health-check the candidate under live traffic',
      'Cut 100% of traffic',
      'Squash-merge the pull request',
      'Assert the merged tree equals the canaried tree',
      'Retag the proven image',
      'Pin traffic to the promoted revision',
    ].map((name) => yml.indexOf(name));

    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// ---------------------------------------------------------------------------
// rollback-readiness
// ---------------------------------------------------------------------------

describe('promote.yml — the rollback path', () => {
  it('captures the restore point before anything is mutated', () => {
    const capture = yml.indexOf('Capture the rollback target');
    const build = yml.indexOf('Build and push the image');
    const deploy = yml.indexOf('Deploy the candidate revision');

    expect(capture).toBeGreaterThanOrEqual(0);
    expect(capture).toBeLessThan(build);
    expect(capture).toBeLessThan(deploy);
  });

  it('rolls back on failure, cancellation, or the job hitting its own timeout', () => {
    // failure() alone does not cover a job cancelled by timeout-minutes — GitHub marks that
    // job `cancelled`, not `failed`, and a step whose own `if` is not always() is skipped once
    // the job's status is cancelled, before its condition is even evaluated. Both gaps must be
    // closed: always() to keep the step in play, cancelled() alongside failure() to decide it
    // should run.
    const rollback = stepContaining('Roll back on failure');

    expect(rollback).toContain('always()');
    expect(rollback).toContain('failure()');
    expect(rollback).toContain('cancelled()');
    expect(rollback).toContain('scripts/promote/rollback.sh');
  });

  it('does not attempt a rollback when there is no restore point', () => {
    const rollback = stepContaining('Roll back on failure');

    expect(rollback).toMatch(/steps\.capture\.conclusion == 'success'/);
  });

  it('does NOT move traffic once the change has merged', () => {
    // The tree-equality hazard. After the merge the commit is on the base branch and cannot be
    // un-merged here, so restoring traffic would leave main describing something production is
    // not running. Traffic stays on the canaried revision — the proven artefact — and a human
    // decides. Dropping this condition is what would silently turn that ruling into its
    // opposite.
    const rollback = stepContaining('Roll back on failure');

    expect(rollback).toMatch(/steps\.merge\.conclusion != 'success'/);
  });

  it('never rebuilds as part of recovery', () => {
    const rollback = stepContaining('Roll back on failure');

    expect(rollback).not.toContain('docker build');
    expect(rollback).not.toContain('gcloud run deploy');
  });
});

// ---------------------------------------------------------------------------
// Supply chain and permission scoping
// ---------------------------------------------------------------------------

describe('promote.yml — pins and permissions', () => {
  it('pins every action to a 40-character commit SHA', () => {
    expect(flat).not.toMatch(/uses: [a-z0-9/_-]+@v\d/);
    expect(flat).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
    expect(flat).toMatch(/uses: google-github-actions\/auth@[0-9a-f]{40}/);
    expect(flat).toMatch(/uses: google-github-actions\/setup-gcloud@[0-9a-f]{40}/);
  });

  it('grants nothing at the top level', () => {
    expect(yml).toMatch(/^permissions: \{\}/m);
  });

  it('grants the job exactly what the sequence uses', () => {
    const withoutComments = yml
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');

    expect(withoutComments).toMatch(/contents: write/);
    expect(withoutComments).toMatch(/pull-requests: write/);
    expect(withoutComments).toMatch(/id-token: write/);
    expect(withoutComments).toMatch(/checks: read/);
  });

  it('does not persist the checkout credential into later steps', () => {
    expect(flat).toMatch(/persist-credentials: false/);
  });
});

// ---------------------------------------------------------------------------
// The trigger family, which decides whether this can ever promote itself
// ---------------------------------------------------------------------------

describe('promote.yml — the trigger lets this workflow promote its own pull request', () => {
  it('triggers on pull_request, not on a default-branch-only event', () => {
    // check_run, check_suite and workflow_run all run from the DEFAULT branch, so a promotion
    // workflow triggered by one of them could not run from a PR's own branch — it would have to
    // land by the very route it exists to replace.
    expect(yml).toMatch(/on:\s*\n\s*pull_request:/);
    expect(yml).not.toMatch(/^\s*workflow_run:/m);
    expect(yml).not.toMatch(/^\s*check_suite:/m);
  });

  it('promotes on a deliberate label rather than on every push', () => {
    expect(yml).toMatch(/types: \[labeled, synchronize\]/);
    expect(flat).toMatch(/contains\(github\.event\.pull_request\.labels\.\*\.name, 'promote'\)/);
  });

  it('never promotes a draft', () => {
    expect(flat).toMatch(/github\.event\.pull_request\.draft == false/);
  });
});
