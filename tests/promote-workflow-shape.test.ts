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
// The job bound must exceed the floor its own steps set. 45 vs a derived 55 was a live bug
// earlier tonight, and nothing caught it — this is what catches it next time.
// ---------------------------------------------------------------------------

interface StepTimeout {
  readonly name: string;
  readonly minutes: number;
}

/** The job-level timeout-minutes: 4-space indent, distinct from any step's 8-space one. */
function jobTimeoutMinutes(): number {
  const m = /\n    timeout-minutes: (\d+)/.exec(yml);
  if (!m) throw new Error('promote.yml: could not find the job-level timeout-minutes.');
  return Number(m[1]);
}

/** Every step's own name and timeout-minutes bound, derived from the file, never hardcoded. */
function stepTimeouts(): StepTimeout[] {
  return steps().map((s) => {
    const timeoutMatch = /timeout-minutes: (\d+)/.exec(s);
    if (!timeoutMatch) {
      throw new Error(`promote.yml: a step has no timeout-minutes — ${s.slice(0, 60)}`);
    }
    const nameMatch = /name: (.+)/.exec(s);
    const name = nameMatch ? nameMatch[1]!.trim() : s.slice(0, 60).replace(/\n/g, ' ');
    return { name, minutes: Number(timeoutMatch[1]) };
  });
}

describe('promote.yml — the job bound exceeds the floor its own steps set', () => {
  const job = jobTimeoutMinutes();
  const sorted = [...stepTimeouts()].sort((a, b) => b.minutes - a.minutes);
  const [largest, secondLargest] = sorted;
  const floor = largest.minutes + secondLargest.minutes;

  it('found real step timeouts to derive a floor from (a trivial list would prove nothing)', () => {
    expect(sorted.length).toBeGreaterThan(2);
    expect(floor).toBeGreaterThan(0);
  });

  it(
    'exceeds the sum of its own two largest step bounds — below that floor a healthy run, ' +
      'not a hung one, could be killed by the job timeout before either step got to fail on ' +
      'its own terms',
    () => {
      expect(job).toBeGreaterThan(floor);
    },
  );

  it('the job-timeout comment cannot silently drift from the file it describes', () => {
    // Pins the one number in the comment that is actually load-bearing — the floor itself —
    // against the derived value. The comment's own "~220" / "roughly 165" figures state their
    // own approximation and are not chased here; this is the number the bound must clear.
    expect(floor).toBe(55);
    expect([largest.minutes, secondLargest.minutes].sort((a, b) => b - a)).toEqual([35, 20]);

    const concurrencyIdx = yml.indexOf('cancel-in-progress: false');
    const jobTimeoutIdx = yml.search(/\n    timeout-minutes: \d+/);
    const jobComment = yml.slice(concurrencyIdx, jobTimeoutIdx);
    expect(jobComment).toContain('already sum to 55');
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

    // 10, then 100 — and ONLY once each. A prior version of this workflow re-issued the 100%
    // cut a second time in the tag-drop step, on the mistaken theory that the first cut moved
    // traffic by tag rather than by name; shift-traffic.sh never moves traffic by tag, so the
    // second call was a true duplicate, added a failure point after the point where rollback is
    // deliberately disabled, and was removed. A second 100 reappearing here means that
    // regressed.
    expect(percents).toEqual([10, 100]);
  });

  it('does not re-cut traffic after the merge — only the candidate tag is dropped there', () => {
    // The step after the merge must not carry its own traffic-shift failure point: past the
    // merge, rollback.sh's own merge-state guard refuses to move traffic at all, so a failure
    // in a redundant cut here could never have been recovered automatically.
    const dropTag = stepContaining('Drop the candidate tag');

    expect(dropTag).toContain('scripts/remove-preview-tag.sh');
    expect(dropTag).not.toContain('scripts/promote/shift-traffic.sh');
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

    expect(health).toContain('observe-canary.sh "$TAG_URL"');
    expect(health).not.toContain('smoke.sh "$SERVICE_URL"');
    expect(health).not.toContain('observe-canary.sh "$SERVICE_URL"');
  });

  it('observes the candidate over a bounded dwell rather than a single instantaneous probe', () => {
    // A single probe fired the instant traffic lands proves only that the candidate answered
    // once. The dwell is what gives a defect that develops from serving real traffic — a pool
    // exhausting, memory pressure building — a window to surface before the cut goes to 100%.
    const health = stepContaining('Health-check the candidate under live traffic');

    expect(health).toContain('scripts/promote/observe-canary.sh');
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
// The invoker identity must never be the one active when traffic is mutated. The auth action
// REPLACES the ambient gcloud credential rather than adding to it, so once the smoke token is
// minted as ds-invoker (deliberately invoke-only, holding nothing else — 2S.5) every gcloud
// call after it inherits that identity until something re-authenticates. This is what actually
// failed in the first live promotion run: shift-traffic.sh and rollback.sh both need
// run.services.get, which ds-invoker does not have.
//
// This is deliberately NOT pinned to today's single re-auth step. It replays the whole step
// sequence and tracks which identity was MOST RECENTLY authenticated at each point, then checks
// every traffic-mutating step against that — so a future step added anywhere after the invoker
// mint, without re-authenticating, is caught the same way, not just the specific gap fixed here.
// ---------------------------------------------------------------------------

type Identity = 'NONE' | 'DEPLOYER' | 'INVOKER' | 'UNKNOWN';

// steps() splits on the step boundary alone, so a comment block written ABOVE a step (this
// file's own convention for explaining the next step) is textually still attached to the END
// of the PREVIOUS step's slice. Scanning raw step text for a pattern like "shift-traffic.sh"
// would then also match a prior step whose own comment merely NAMES that script in prose —
// exactly the false positive this stripping avoids. Only non-comment lines are examined for
// both the identity marker and the traffic-mutating pattern below.
function stripComments(s: string): string {
  return s
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** The most-recently-authenticated identity at each step, in file order. */
function identityAtEachStep(): Identity[] {
  let current: Identity = 'NONE';
  return steps().map((raw) => {
    const s = stripComments(raw);
    if (/uses: google-github-actions\/auth@[0-9a-f]{40}/.test(s)) {
      if (/service_account:\s*\$\{\{\s*env\.DEPLOYER_SA\s*\}\}/.test(s)) current = 'DEPLOYER';
      else if (/service_account:\s*\$\{\{\s*env\.INVOKER_SA\s*\}\}/.test(s)) current = 'INVOKER';
      else current = 'UNKNOWN';
    }
    return current;
  });
}

/** A step whose run: block could move or restore traffic — by name or by the raw gcloud verb. */
const TRAFFIC_MUTATING = [/update-traffic/, /shift-traffic\.sh/, /rollback\.sh/];

describe('promote.yml — the invoker identity is never the one active when traffic moves', () => {
  const all = steps();
  const identities = identityAtEachStep();
  const trafficSteps = all
    .map((s, i) => ({ s: stripComments(s), i }))
    .filter(({ s }) => TRAFFIC_MUTATING.some((re) => re.test(s)));

  it('found real traffic-mutating steps to check (a trivial list would prove nothing)', () => {
    expect(trafficSteps.length).toBeGreaterThanOrEqual(2);
  });

  it('is authenticated as the deployer, never the invoker or nothing, at every one of them', () => {
    const offenders = trafficSteps
      .filter(({ i }) => identities[i] !== 'DEPLOYER')
      .map(({ s, i }) => {
        const m = /name: (.+)/.exec(s);
        const name = m ? m[1]!.trim() : s.slice(0, 60).replace(/\n/g, ' ');
        return `${name} (identity: ${identities[i]})`;
      });

    expect(offenders).toEqual([]);
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
// The authorization boundary — applying a label needs only 'triage', which is narrower than
// what actually moving production traffic and merging to main should require
// ---------------------------------------------------------------------------

describe('promote.yml — the actor is checked for write access, not just label-apply rights', () => {
  it('checks the actor before anything else runs, right after the fork guard', () => {
    const authIdx = yml.indexOf('Verify the actor holds write access');
    const waitIdx = yml.indexOf('Wait for every other check');
    const forkIdx = yml.indexOf('Skip promotion for fork pull requests');

    expect(authIdx).toBeGreaterThan(forkIdx);
    expect(authIdx).toBeLessThan(waitIdx);
  });

  it('delegates the decision to a tested script, not an inline permission string', () => {
    const auth = stepContaining('Verify the actor holds write access');

    expect(auth).toContain('scripts/promote/assert-authorized.sh');
    expect(auth).toMatch(/assert-authorized\.sh[\s\S]*github\.repository[\s\S]*github\.actor/);
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
      'Re-authenticate as the deploy identity before anything touches traffic',
      'Smoke the candidate while it carries no traffic',
      'Cut 10% of traffic',
      'Health-check the candidate under live traffic',
      'Cut 100% of traffic',
      'Squash-merge the pull request',
      'Assert the merged tree equals the canaried tree',
      'Retag the proven image',
      'Drop the candidate tag now that traffic is pinned',
      'Close the preview environment for the merged pull request',
    ].map((name) => yml.indexOf(name));

    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// ---------------------------------------------------------------------------
// The preview environment is closed on a successful self-promoted merge, because
// `pull_request: closed` is never delivered for a merge performed as GITHUB_TOKEN.
// ---------------------------------------------------------------------------

describe('promote.yml — the preview environment is closed after a successful merge', () => {
  it('exists, after the candidate tag is dropped', () => {
    const close = stepContaining('Close the preview environment for the merged pull request');
    const dropIdx = yml.indexOf('Drop the candidate tag now that traffic is pinned');
    const closeIdx = yml.indexOf('Close the preview environment for the merged pull request');

    expect(close).not.toBe('');
    expect(closeIdx).toBeGreaterThan(dropIdx);
  });

  it('runs only when the merge actually succeeded', () => {
    // If the promotion failed or rolled back, the preview must survive — that is exactly when
    // an operator needs it.
    const close = stepContaining('Close the preview environment for the merged pull request');

    expect(close).toMatch(/steps\.merge\.conclusion == 'success'/);
  });

  it('ALSO requires tree equality — merge success alone is not the last correctness assertion', () => {
    // "Assert the merged tree equals the canaried tree" runs AFTER the merge and can fail even
    // though the merge itself succeeded. That is precisely the incident where the preview must
    // stay up: main holds a tree nobody canaried, and an operator needs the preview deployment
    // alive to compare against. Gating on merge success alone would close it in exactly that
    // case — this is the regression test for that gap.
    const close = stepContaining('Close the preview environment for the merged pull request');

    expect(close).toMatch(/steps\.tree_equal\.conclusion == 'success'/);
  });

  it('the tree-equality step carries the id this gate depends on', () => {
    const treeEqual = stepContaining('Assert the merged tree equals the canaried tree');

    expect(treeEqual).toMatch(/id: tree_equal/);
  });

  it('carries always(), so an earlier non-fatal step failure cannot suppress it', () => {
    const close = stepContaining('Close the preview environment for the merged pull request');

    expect(close).toContain('always()');
  });

  it('delegates to a tested script, not an inline run: block', () => {
    const close = stepContaining('Close the preview environment for the merged pull request');

    expect(close).toContain('scripts/promote/close-preview-environment.sh');
  });

  it('routes the branch name through env:, never interpolating it directly', () => {
    // head.ref is a git ref name and may legally contain backticks, $() and quotes — the same
    // injection hazard BASE_REF is routed around elsewhere in this file.
    const close = stepContaining('Close the preview environment for the merged pull request');

    expect(close).toMatch(/HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
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

  it('gives rollback.sh the means to verify actual merge state, not just the step conclusion', () => {
    // steps.merge.conclusion != 'success' is necessary but not sufficient: gh pr merge can
    // succeed on GitHub's side and then have ITS OWN STEP marked cancelled or failed by a
    // job-level timeout landing mid-step. The workflow condition alone cannot tell that apart
    // from a merge that never happened, so rollback.sh is passed the repo and PR number and
    // asks GitHub directly — the same question squash-merge.sh already asks for idempotency —
    // as a second, independent check before it moves any traffic.
    const rollback = stepContaining('Roll back on failure').replace(/\s+/g, ' ');

    expect(rollback).toContain('scripts/promote/rollback.sh');
    expect(rollback).toMatch(/rollback\.sh[^;]*\$\{\{ github\.repository \}\}[^;]*\$\{\{ github\.event\.pull_request\.number \}\}/);
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

// ---------------------------------------------------------------------------
// input-validation — no pull-request context field lands raw in a shell run: block
//
// ${{ }} expressions are substituted into the script TEXT before the shell parses it. A git
// branch name (base.ref, head.ref) or free text (title, body, a label name) may legally contain
// backticks, $() and quotes, so interpolating one directly opens script injection in a job that
// authenticates via WIF, mints Cloud Run credentials, and merges to main unattended. This is
// what a base.ref interpolation in two steps did until this was found and fixed.
// ---------------------------------------------------------------------------

/**
 * Every line of every `run:` block's content — both `run: |` blocks and single-line `run:`
 * steps — with step names, `if:`, `env:` and `with:` blocks excluded. `env:` is exactly where a
 * pull-request field SHOULD live, so scanning it would defeat the point of the fix.
 */
function runBlockLines(): string[] {
  const lines = yml.split('\n');
  const collected: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const blockStart = /^(\s+)run: \|\s*$/.exec(line);
    if (blockStart) {
      const indent = blockStart[1]!.length;
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j]!;
        if (l.trim() === '') {
          j++;
          continue;
        }
        const lineIndent = l.length - l.trimStart().length;
        if (lineIndent <= indent) break;
        collected.push(l);
        j++;
      }
      i = j - 1;
      continue;
    }
    const singleLine = /^\s+run: (.+)$/.exec(line);
    if (singleLine) {
      collected.push(singleLine[1]!);
    }
  }
  return collected;
}

describe('promote.yml — pull-request context fields never land raw in a shell run: block', () => {
  // Allowlisted BY FIELD, not by trusting "it's from the pull request": both are structurally
  // constrained regardless of what the PR author chose — head.sha is a 40-hex git SHA computed
  // by git, and number is a GitHub-assigned integer. Neither can carry a shell metacharacter.
  // Everything else under github.event.pull_request is free text or attacker-influenced and
  // MUST be routed through env: — this is a DENYLIST by default, so a field added later, not
  // just base.ref (the one this pins), is caught without anyone updating this test.
  const SAFE_PR_FIELDS = ['head.sha', 'number'];

  it('found real run: content to scan (a trivial list would prove nothing)', () => {
    expect(runBlockLines().length).toBeGreaterThan(50);
  });

  it('never interpolates an unvetted pull-request field directly into a run: block', () => {
    const offenders: string[] = [];
    for (const line of runBlockLines()) {
      for (const m of line.matchAll(/\$\{\{\s*github\.event\.pull_request\.([a-zA-Z0-9_.]+)\s*\}\}/g)) {
        const field = m[1]!;
        if (!SAFE_PR_FIELDS.includes(field)) {
          offenders.push(`github.event.pull_request.${field}  (in: ${line.trim()})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
