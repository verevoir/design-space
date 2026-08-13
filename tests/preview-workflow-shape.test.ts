import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shape regression tests for preview.yml — the same zero-dependency text-shape approach
// used by ci-workflow-shape.test.ts for ci.yml. The properties pinned here are the ones a
// careless edit would silently drop: fork guard on every deploy step, --no-traffic on the
// deploy, tag naming, concurrency group, timeout-minutes, SHA-pinned actions, that the
// audience is the SERVICE url while requests go to the TAG url, and that the token is not
// on a command line.

const yml = readFileSync(
  fileURLToPath(new URL('../.github/workflows/preview.yml', import.meta.url)),
  'utf8'
);
const flat = yml.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Extract the smoke-step block so assertions about what goes on the command
// line are scoped to that step alone, not the whole file.
// ---------------------------------------------------------------------------

/**
 * Extract the YAML block for the "Run smoke tests" step, from the line
 * containing that step name up to (but not including) the next step boundary.
 */
function extractSmokeStepBlock(): string {
  const stepNameIdx = yml.indexOf('Run smoke tests against the preview revision');
  if (stepNameIdx < 0) return '';
  const stepStart = yml.lastIndexOf('\n', stepNameIdx);
  const nextStep = yml.indexOf('\n      - ', stepNameIdx + 1);
  const stepEnd = nextStep >= 0 ? nextStep : yml.length;
  return yml.slice(stepStart, stepEnd);
}

const smokeStep = extractSmokeStepBlock();

/**
 * Extract the YAML block for the deploy step (gcloud run deploy).
 */
function extractDeployStepBlock(): string {
  const stepIdx = yml.indexOf('Deploy revision with pr-');
  if (stepIdx < 0) return '';
  const stepStart = yml.lastIndexOf('\n', stepIdx);
  const nextStep = yml.indexOf('\n      - ', stepIdx + 1);
  const stepEnd = nextStep >= 0 ? nextStep : yml.length;
  return yml.slice(stepStart, stepEnd);
}

const deployStep = extractDeployStepBlock();

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe('preview.yml — concurrency', () => {
  it('declares a concurrency group', () => {
    // Without this, every push to a PR runs to completion in parallel.
    expect(yml).toContain('concurrency:');
  });

  it('keys each concurrency group on the PR number', () => {
    // The PR number gives each PR its own groups, so a cancel never reaches another PR or a
    // main-branch run. The groups are per job — see 'concurrency is per job, not shared'.
    expect(flat).toMatch(/group: preview-deploy-\$\{\{ github\.event\.pull_request\.number \}\}/);
    expect(flat).toMatch(/group: preview-cleanup-\$\{\{ github\.event\.pull_request\.number \}\}/);
  });

  it('sets cancel-in-progress: true', () => {
    // A group without cancel-in-progress: true only serialises runs — it does
    // not cancel the stale in-flight run.
    expect(flat).toMatch(/concurrency:.*cancel-in-progress: true/);
  });
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe('preview.yml — job timeout', () => {
  it('declares timeout-minutes on the deploy job', () => {
    // Without a timeout a hung docker build or gcloud call holds the runner
    // until the 6-hour repository ceiling.
    expect(flat).toMatch(/timeout-minutes: \d+/);
  });

  it('sets a finite, sensible timeout (≤ 60)', () => {
    const m = flat.match(/timeout-minutes: (\d+)/);
    expect(m).not.toBeNull();
    const minutes = parseInt(m![1], 10);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// Action pin discipline
// ---------------------------------------------------------------------------

describe('preview.yml — action SHA pins', () => {
  it('pins actions/checkout to a 40-character commit SHA', () => {
    expect(flat).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
  });

  it('pins google-github-actions/auth to a 40-character commit SHA', () => {
    expect(flat).toMatch(/uses: google-github-actions\/auth@[0-9a-f]{40}/);
  });

  it('pins google-github-actions/setup-gcloud to a 40-character commit SHA', () => {
    expect(flat).toMatch(/uses: google-github-actions\/setup-gcloud@[0-9a-f]{40}/);
  });

  it('pins actions/github-script to a 40-character commit SHA', () => {
    expect(flat).toMatch(/uses: actions\/github-script@[0-9a-f]{40}/);
  });

  it('has no action reference that uses only a version tag (e.g. @v2)', () => {
    // Belt-and-suspenders: reject any `uses:` line carrying @v<digit> without a SHA.
    expect(flat).not.toMatch(/uses: [a-z0-9/_-]+@v\d/);
  });
});

// ---------------------------------------------------------------------------
// Fork guard — every deploy step must be gated
// ---------------------------------------------------------------------------

describe('preview.yml — fork guard on deploy steps', () => {
  it('Authenticate to Google Cloud step carries the fork guard condition', () => {
    // Without this, a fork PR would attempt to authenticate and hit a WIF error
    // instead of a graceful skip.
    const authIdx = yml.indexOf('Authenticate to Google Cloud via WIF');
    expect(authIdx).toBeGreaterThanOrEqual(0);
    const nextStep = yml.indexOf('\n      - ', authIdx + 1);
    const block = nextStep >= 0 ? yml.slice(authIdx, nextStep) : yml.slice(authIdx);
    expect(block).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('Deploy revision step carries the fork guard condition', () => {
    expect(deployStep).not.toBe('');
    expect(deployStep).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('Run smoke tests step carries the fork guard condition', () => {
    expect(smokeStep).not.toBe('');
    expect(smokeStep).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('cleanup job carries the fork guard condition', () => {
    // Cleanup must not run for fork PRs that never had a revision deployed.
    expect(flat).toMatch(/cleanup:.*github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  });
});

// ---------------------------------------------------------------------------
// Deploy correctness — --no-traffic and tag naming
// ---------------------------------------------------------------------------

describe('preview.yml — deploy correctness', () => {
  it('deploys with --no-traffic so the revision receives no production traffic', () => {
    // ADR 0007: the revision must carry no traffic until promoted.  A careless
    // edit removing --no-traffic would silently put untested code in production.
    expect(deployStep).toContain('--no-traffic');
  });

  it('tags the revision as pr-<PR number>', () => {
    // The tag must embed the PR number so each PR gets a distinct URL and so the
    // cleanup job can remove exactly that tag when the PR closes.  The deploy step
    // sets TAG="pr-${{ ... }}" and passes --tag "$TAG", so we check both: that
    // the tag variable is set with the PR number, and that --tag uses it.
    expect(deployStep).toMatch(/TAG="pr-\$\{\{.*pull_request\.number/);
    expect(deployStep).toContain('--tag');
  });
});

// ---------------------------------------------------------------------------
// Audience / request URL separation — the token audience is the SERVICE url
// while the request goes to the TAG url.
// ---------------------------------------------------------------------------

describe('preview.yml — ID token audience vs request URL', () => {
  it('mints the ID token with the SERVICE_URL as audience, not the TAG url', () => {
    // Cloud Run validates the audience against the service URL, not the per-tag
    // URL.  A token minted for the tag URL would be rejected with "Unauthorized".
    // Located by the structural marker rather than the step's display name: renaming a step
    // is not a behaviour change, and this test failed for that reason once.
    const mintIdx = yml.indexOf('token_format: id_token');
    expect(mintIdx).toBeGreaterThanOrEqual(0);
    const stepStart = yml.lastIndexOf('\n      - ', mintIdx);
    const nextStep = yml.indexOf('\n      - ', mintIdx + 1);
    const mintBlock = yml.slice(stepStart, nextStep >= 0 ? nextStep : undefined);
    expect(mintBlock).toMatch(/id_token_audience:.*SERVICE_URL/);
    expect(mintBlock).not.toMatch(/id_token_audience:.*TAG_URL/);
  });

  it('smoke step uses TAG_URL as the request target, not the SERVICE_URL', () => {
    // The request must go to the tagged revision's URL to exercise that revision
    // specifically, not the service's live (traffic-weighted) URL.
    expect(smokeStep).toContain('TAG_URL');
    expect(smokeStep).not.toMatch(/smoke\.sh.*SERVICE_URL/);
  });
});

// ---------------------------------------------------------------------------
// Secret handling — token must not appear on the command line
// ---------------------------------------------------------------------------

describe('preview.yml — token not on the command line', () => {
  it('smoke step does not interpolate the id_token output directly on the command line', () => {
    // Passing a secret via ${{ steps.x.outputs.y }} on a `run:` command line
    // causes it to be echoed in the workflow log.  The value must be supplied
    // through env: instead and read by the script from there.
    expect(smokeStep).not.toMatch(/smoke\.sh.*steps\.preview_token\.outputs\.id_token/);
  });

  it('smoke step passes the token via an env: block, not as a positional argument', () => {
    // The safe route: env: maps the secret to an environment variable; the script
    // reads it from the environment rather than receiving it on $2.
    expect(smokeStep).toMatch(/env:[\s\S]*SMOKE_ID_TOKEN/);
  });

  it('a masking step registers the token with ::add-mask:: before the smoke step runs', () => {
    // ::add-mask:: causes the runner to redact the value from all subsequent log
    // output.  The mask step must appear before the smoke step.
    const maskIdx = yml.indexOf('::add-mask::');
    const smokeIdx = yml.indexOf('Run smoke tests against the preview revision');
    expect(maskIdx).toBeGreaterThanOrEqual(0);
    expect(smokeIdx).toBeGreaterThanOrEqual(0);
    expect(maskIdx).toBeLessThan(smokeIdx);
  });

  it('masking step supplies the token via env: not via ${{ }} interpolation in the command', () => {
    // Interpolating the token into `echo "::add-mask::${{ token }}"` would echo
    // the raw value to the log before the mask takes effect — defeating the purpose.
    const maskIdx = yml.indexOf('Mask the preview token');
    expect(maskIdx).toBeGreaterThanOrEqual(0);
    const nextStep = yml.indexOf('\n      - ', maskIdx + 1);
    const maskBlock = nextStep >= 0 ? yml.slice(maskIdx, nextStep) : yml.slice(maskIdx);
    // The mask command must read from an env var ($TOKEN), not from a ${{ }} expression.
    expect(maskBlock).toMatch(/echo "::add-mask::\$TOKEN"/);
    expect(maskBlock).not.toMatch(/add-mask::\$\{\{/);
  });
});

describe('every run: block is valid shell', () => {
  /**
   * A stray `fi` shipped in the cleanup step and five review lenses caught it before any
   * machine did — because that job had only ever been SKIPPED, so its shell was never parsed.
   * Inline workflow shell is only executed when its trigger fires, which can be never. This
   * parses every block at test time instead.
   */
  it('parses under bash -n, so a syntax error cannot wait for a trigger to be discovered', async () => {
    const { spawnSync } = await import('node:child_process');
    const { readdirSync } = await import('node:fs');

    // EVERY workflow, not just this one — architecture.md claims that, and a claim about all
    // of them that only checked one is the failure this repository keeps producing.
    const dir = new URL('../.github/workflows/', import.meta.url).pathname;
    const all = readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => readFileSync(`${dir}${f}`, 'utf-8'))
      .join('\n');
    const lines = all.split('\n');
    const blocks: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      // Three spellings, because two were not enough twice running:
      //   run: |            block scalar as a later key
      //   - run: |          block scalar as a step's first key
      //   run: <command>    a single-line command, either form
      // The first widening missed `- run: |`; the second still missed the single-line form,
      // which this file's own workflows use nine times. Each time the comment claimed
      // completeness the code did not deliver.
      const line = lines[i] ?? '';
      const scalar = /^(\s*)(- )?run: \|\s*$/.exec(line);
      const single = /^(\s*)(- )?run: (?!\|)(\S.*)$/.exec(line);

      if (single) {
        blocks.push(single[3] ?? '');
        continue;
      }
      if (!scalar) continue;

      const indent = (scalar[1]?.length ?? 0) + (scalar[2] ? scalar[2].length : 0) + 2;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const isBlank = l.trim() === '';
        const deepEnough = l.length - l.trimStart().length >= indent;
        if (!isBlank && !deepEnough) break;
        body.push(l.length >= indent ? l.slice(indent) : l);
        i++;
      }
      blocks.push(body.join('\n'));
      i--;
    }

    expect(blocks.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const [n, block] of blocks.entries()) {
      // GitHub expressions are not shell; substitute a token so bash sees a valid word.
      const cleaned = block.replace(/\$\{\{[^}]*\}\}/g, 'X');
      const res = spawnSync('bash', ['-n'], { input: cleaned, encoding: 'utf-8' });
      if (res.status !== 0) failures.push(`block ${n + 1}: ${res.stderr.trim().split('\n')[0]}`);
    }

    expect(failures).toEqual([]);
  });
});

describe('every job that runs a repo script checks the repo out', () => {
  /**
   * The cleanup job shipped without a checkout while its logic was inline shell, then kept
   * running after that logic moved into scripts/ — so it would have invoked bash against a file
   * that was never on the runner. It has only ever been skipped, so nothing executed it.
   */
  it('the cleanup job checks out before invoking scripts/', () => {
    const cleanup = yml.slice(yml.indexOf('\n  cleanup:'));

    expect(cleanup).toContain('scripts/remove-preview-tag.sh');
    expect(cleanup).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);

    // Order matters: a checkout after the script would not help.
    expect(cleanup.indexOf('actions/checkout@')).toBeLessThan(
      cleanup.indexOf('scripts/remove-preview-tag.sh'),
    );
  });
});

describe('the event shapes the workflow header describes', () => {
  /**
   * The header states the whole design: opened / synchronize / reopened do the deploy,
   * closed removes the tag. Nothing pinned that, so a trigger edit could silently make the
   * deploy job run on close (deploying a merged branch) or stop the cleanup running at all.
   */
  it('deploys on opened, synchronize and reopened, and not on closed', () => {
    expect(yml).toMatch(/types:\s*\[[^\]]*opened[^\]]*\]/);
    expect(yml).toMatch(/types:\s*\[[^\]]*synchronize[^\]]*\]/);
    expect(yml).toMatch(/types:\s*\[[^\]]*reopened[^\]]*\]/);
    expect(yml).toMatch(/types:\s*\[[^\]]*closed[^\]]*\]/);

    const deployJob = yml.slice(yml.indexOf('\n  deploy:'), yml.indexOf('\n  cleanup:'));
    expect(deployJob).toMatch(/if:\s*github\.event\.action != 'closed'/);
  });

  it('cleans up only on closed, and only for same-repo PRs', () => {
    const cleanup = yml.slice(yml.indexOf('\n  cleanup:'));

    expect(cleanup).toMatch(/github\.event\.action == 'closed'/);
    // A fork PR never deployed, so there is nothing to remove — and no credential to do it with.
    expect(cleanup).toMatch(/head\.repo\.full_name == github\.repository/);
  });
});

describe('per-job permission scoping', () => {
  /**
   * The file documents this as a deliberate security decision: an empty top-level grant, with
   * each job asking for what it uses. Unpinned, a later edit could restore a workflow-wide
   * grant and the comment would still claim least privilege.
   */
  it('grants nothing at the top level', () => {
    expect(yml).toMatch(/^permissions: \{\}/m);
  });

  it('gives the deploy job pull-requests: write and the cleanup job none', () => {
    // Strip comments first. The cleanup job's own comment reads "deliberately NO
    // pull-requests: write", so a naive text search finds the phrase it exists to deny —
    // the test would have been asserting against prose rather than against the grant.
    const withoutComments = (s: string) =>
      s
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n');

    const deployJob = withoutComments(
      yml.slice(yml.indexOf('\n  deploy:'), yml.indexOf('\n  cleanup:')),
    );
    const cleanup = withoutComments(yml.slice(yml.indexOf('\n  cleanup:')));

    expect(deployJob).toMatch(/pull-requests: write/);
    // The cleanup job comments on nothing; a write grant there would be unused authority.
    expect(cleanup).not.toMatch(/pull-requests: write/);
    expect(cleanup).toMatch(/id-token: write/);
  });
});

describe('concurrency is per job, not shared', () => {
  /**
   * A single workflow-level group covers both jobs, so a deploy-triggering event can cancel an
   * in-flight cleanup: close a PR, then push or reopen, and the tag removal aborts partway with
   * nothing scheduled to finish it. Deploys are safe to supersede; cleanups are not.
   */
  it('has no workflow-level concurrency group', () => {
    const beforeJobs = yml.slice(0, yml.indexOf('\njobs:'));

    expect(beforeJobs).not.toMatch(/^concurrency:/m);
  });

  it('cancels superseded deploys but never a cleanup', () => {
    const deployJob = yml.slice(yml.indexOf('\n  deploy:'), yml.indexOf('\n  cleanup:'));
    const cleanup = yml.slice(yml.indexOf('\n  cleanup:'));

    expect(deployJob).toMatch(/concurrency:[\s\S]{0,200}cancel-in-progress: true/);
    expect(cleanup).toMatch(/concurrency:[\s\S]{0,200}cancel-in-progress: false/);
  });

  it('keys the two groups separately so they cannot cancel each other', () => {
    expect(yml).toMatch(/group: preview-deploy-/);
    expect(yml).toMatch(/group: preview-cleanup-/);
  });
});
