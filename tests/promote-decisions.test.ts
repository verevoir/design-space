import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { summariseChecks, excludeSelf, parseCheckRuns, exitCodeFor, describeVerdict } from '../scripts/promote/checks-green.mjs';
import { snapshotFromDescribe, restoreSpec, revisionForTag } from '../scripts/promote/traffic-snapshot.mjs';
import { expectationsFor } from '../scripts/journey-expectations.mjs';

// journey-expectations.mjs's CLI usage-error guard lives only inside its
// `if (process.argv[1] && ...)` entry point — reached only when the file is run directly, the
// same shape as traffic-snapshot.mjs's CLI argument validation, which needed the same treatment.
const JOURNEY_EXPECTATIONS_CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/journey-expectations.mjs');

function runJourneyExpectationsCli(args: string[]) {
  const res = spawnSync('node', [JOURNEY_EXPECTATIONS_CLI, ...args], { encoding: 'utf-8' });
  return { code: res.status ?? 1, out: res.stdout ?? '', err: res.stderr ?? '' };
}

// The decisions the promotion turns on, tested as pure functions. They live outside the
// workflow because an inline run: block only executes when its trigger fires — which, for a
// rollback path or a deadlock guard, can be never until it matters.

const completed = (name: string, conclusion: string) => ({ name, status: 'completed', conclusion });
const running = (name: string) => ({ name, status: 'in_progress', conclusion: null });

describe('checks-green — excluding this workflow from its own gate', () => {
  it('drops the named check', () => {
    const kept = excludeSelf([completed('promote', 'success'), completed('ci', 'success')], ['promote']);

    expect(kept.map((c) => c.name)).toEqual(['ci']);
  });

  it('matches the name exactly, never as a substring', () => {
    // A substring match would widen "ignore myself" into "ignore anything that looks like me",
    // so a check called promote-and-deploy would stop being a gate at all.
    const kept = excludeSelf([completed('promote-and-deploy', 'failure')], ['promote']);

    expect(kept.map((c) => c.name)).toEqual(['promote-and-deploy']);
  });

  it('is green once only its own still-running check remains', () => {
    // The deadlock this exists to prevent: the promotion run cannot complete while it waits
    // for a check that is the promotion run.
    const summary = summariseChecks([running('promote'), completed('ci', 'success')], ['promote']);

    expect(summary.state).toBe('green');
  });
});

describe('checks-green — the verdict', () => {
  it('is green when every considered check succeeded', () => {
    expect(summariseChecks([completed('ci', 'success'), completed('review', 'success')]).state).toBe('green');
  });

  it('treats neutral and skipped as not-a-fault', () => {
    // A check that opted out of judging this commit has found nothing wrong.
    expect(summariseChecks([completed('ci', 'success'), completed('optional', 'skipped'), completed('n', 'neutral')]).state).toBe('green');
  });

  it('is pending while any check is unfinished', () => {
    const summary = summariseChecks([completed('ci', 'success'), running('review')]);

    expect(summary.state).toBe('pending');
    expect(summary.pending).toEqual(['review']);
  });

  it('is failed when a check failed, and says which', () => {
    const summary = summariseChecks([completed('ci', 'failure'), completed('review', 'success')]);

    expect(summary.state).toBe('failed');
    expect(summary.failed).toEqual(['ci']);
  });

  it('blocks on a CANCELLED check rather than reading it as harmless', () => {
    // A cancelled check produced no verdict, and treating "no verdict" as "no problem" is how
    // an unreviewed change reaches production.
    expect(summariseChecks([completed('review', 'cancelled')]).state).toBe('failed');
    expect(summariseChecks([completed('review', 'timed_out')]).state).toBe('failed');
    expect(summariseChecks([completed('review', 'action_required')]).state).toBe('failed');
  });

  it('reports a failure ahead of a pending check', () => {
    // Waiting out the rest of a suite that has already failed only delays the same answer.
    expect(summariseChecks([completed('ci', 'failure'), running('review')]).state).toBe('failed');
  });

  it('does NOT read an empty check list as green', () => {
    // A misconfigured trigger, a wrong SHA, or a required workflow that never started all
    // produce an empty list. Reading that as "all clear" would promote a commit whose corpus
    // review never ran — the single thing this gate exists to prevent.
    const summary = summariseChecks([]);

    expect(summary.state).toBe('empty');
    expect(exitCodeFor(summary.state)).toBe(1);
  });

  it('does not read a list emptied BY the exclusion as green either', () => {
    expect(summariseChecks([running('promote')], ['promote']).state).toBe('empty');
  });

  it('maps verdicts to exit codes a caller can branch on', () => {
    expect(exitCodeFor('green')).toBe(0);
    expect(exitCodeFor('pending')).toBe(2);
    expect(exitCodeFor('failed')).toBe(1);
  });

  it('accepts both the API envelope and a bare array', () => {
    expect(parseCheckRuns('{"check_runs":[{"name":"a"}]}')).toHaveLength(1);
    expect(parseCheckRuns('[{"name":"a"}]')).toHaveLength(1);
    expect(() => parseCheckRuns('{"nope":1}')).toThrow();
  });

  it('fails legibly on malformed JSON rather than throwing a raw, unattributed SyntaxError', () => {
    // wait-for-green.sh pipes gh api's own response straight into this. A truncated body, an
    // HTML error page, or empty output previously surfaced as whatever V8's own "Unexpected
    // token" happened to say, with nothing here naming what failed to parse or why it matters.
    expect(() => parseCheckRuns('not json at all')).toThrow(
      /could not parse the check-runs response as JSON/,
    );
  });
});

describe('checks-green — describing the verdict for a human', () => {
  // describeVerdict is what a promotion run actually prints when it blocks — the failure-
  // reporting function's own output. The green/pending paths are already exercised indirectly
  // through wait-for-green.sh; the branch that reports a REAL failed check, and the branch that
  // reports no checks at all, were previously never reached by any test.

  it('names the failing checks when the verdict is failed', () => {
    const summary = summariseChecks([completed('ci', 'failure'), completed('review', 'success')]);

    expect(describeVerdict(summary)).toBe('failed — ci');
  });

  it('names every failing check, not just the first', () => {
    const summary = summariseChecks([completed('ci', 'failure'), completed('review', 'failure')]);

    expect(describeVerdict(summary)).toBe('failed — ci, review');
  });

  it('says empty rather than something that could be misread as passing', () => {
    const summary = summariseChecks([]);

    expect(describeVerdict(summary)).toBe('empty — no checks found for this commit, which is not the same as passing');
  });

  it('names how many checks passed when the verdict is green', () => {
    const summary = summariseChecks([completed('ci', 'success'), completed('review', 'success')]);

    expect(describeVerdict(summary)).toBe('green — 2 check(s) passed');
  });
});

describe('traffic-snapshot — capturing a restore point', () => {
  const describeJson = {
    status: {
      latestReadyRevisionName: 'design-space-studio-00003',
      traffic: [
        { revisionName: 'design-space-studio-00002', percent: 100 },
        { revisionName: 'design-space-studio-00003', percent: 0, tag: 'candidate' },
      ],
    },
  };

  it('captures the revision carrying traffic', () => {
    const snap = snapshotFromDescribe(describeJson, { service: 's', region: 'r' });

    expect(snap.assignments).toEqual([{ revision: 'design-space-studio-00002', percent: 100 }]);
    expect(snap.service).toBe('s');
  });

  it('ignores tag-only entries, which carry no traffic to restore', () => {
    const snap = snapshotFromDescribe(describeJson, { service: 's', region: 'r' });

    expect(snap.assignments.map((a) => a.revision)).not.toContain('design-space-studio-00003');
  });

  it('records the tags that exist', () => {
    expect(snapshotFromDescribe(describeJson, { service: 's', region: 'r' }).tags).toEqual(['candidate']);
  });

  it('resolves LATEST to a concrete revision name', () => {
    // A restore point that says "whatever is latest" is not a restore point: by the time it is
    // used the promotion has deployed a newer revision, so restoring LATEST would route traffic
    // to the very revision being rolled back.
    const snap = snapshotFromDescribe(
      { status: { latestReadyRevisionName: 'rev-9', traffic: [{ latestRevision: true, percent: 100 }] } },
      { service: 's', region: 'r' },
    );

    expect(snap.assignments).toEqual([{ revision: 'rev-9', percent: 100 }]);
    expect(restoreSpec(snap)).toBe('rev-9=100');
  });

  it('refuses a LATEST it cannot resolve rather than guessing', () => {
    expect(() =>
      snapshotFromDescribe({ status: { traffic: [{ latestRevision: true, percent: 100 }] } }, { service: 's', region: 'r' }),
    ).toThrow(/neither a revision nor a resolvable LATEST/);
  });

  it('refuses a snapshot whose percentages do not total 100', () => {
    // A partial snapshot restores partial traffic and leaves the rest wherever the failure put
    // it — a split nobody chose, produced by the very step meant to undo one.
    expect(() =>
      snapshotFromDescribe({ status: { traffic: [{ revisionName: 'a', percent: 60 }] } }, { service: 's', region: 'r' }),
    ).toThrow(/total 60, not 100/);
  });

  it('sums a revision that appears more than once', () => {
    const snap = snapshotFromDescribe(
      { status: { traffic: [{ revisionName: 'a', percent: 90 }, { revisionName: 'a', percent: 10, tag: 't' }] } },
      { service: 's', region: 'r' },
    );

    expect(restoreSpec(snap)).toBe('a=100');
  });

  it('round-trips a split assignment through to the restore argument', () => {
    const snap = snapshotFromDescribe(
      { status: { traffic: [{ revisionName: 'a', percent: 90 }, { revisionName: 'b', percent: 10 }] } },
      { service: 's', region: 'r' },
    );

    expect(restoreSpec(snap)).toBe('a=90,b=10');
  });

  it('refuses to build a restore argument from an empty snapshot', () => {
    expect(() => restoreSpec({ assignments: [] })).toThrow(/nothing to restore/);
  });

  it('refuses to snapshot a describe payload carrying no status.traffic at all, rather than treating it as empty traffic', () => {
    // The function's own doc-comment calls this "the rollback path's whole correctness". A
    // malformed or truncated `gcloud run services describe` response — no status.traffic array
    // at all, as opposed to an empty one — must refuse loudly here rather than be read as "no
    // traffic to restore", which would let a promotion proceed with no real rollback target.
    expect(() => snapshotFromDescribe({ status: {} }, { service: 's', region: 'r' })).toThrow(
      /describe payload has no status\.traffic — cannot capture a restore point/,
    );
    expect(() => snapshotFromDescribe({}, { service: 's', region: 'r' })).toThrow(
      /describe payload has no status\.traffic/,
    );
  });
});

describe('traffic-snapshot — which revision a tag names', () => {
  const describeJson = {
    status: {
      latestReadyRevisionName: 'rev-3',
      traffic: [
        { revisionName: 'rev-2', percent: 100 },
        { revisionName: 'rev-3', percent: 0, tag: 'candidate' },
      ],
    },
  };

  it('reads the revision from the tag entry', () => {
    expect(revisionForTag(describeJson, 'candidate')).toBe('rev-3');
  });

  it('throws when no entry carries the tag, rather than returning something plausible', () => {
    // Returning latestCreatedRevisionName here would be a guess that races any other deploy,
    // and the wrong answer would pin production traffic to a revision nobody smoked.
    expect(() => revisionForTag(describeJson, 'nope')).toThrow(/no traffic entry carries the tag/);
  });

  it('refuses to resolve a tag from a describe payload carrying no status.traffic at all', () => {
    // Distinct from "no entry carries the tag" above: this is the case where the whole traffic
    // array is absent, not merely lacking the requested tag. Falling through to the "no entry"
    // branch here would report the wrong reason — a malformed describe response, not a genuinely
    // untagged revision — which matters when someone is reading this during an incident.
    expect(() => revisionForTag({ status: {} }, 'candidate')).toThrow(/describe payload has no status\.traffic/);
    expect(() => revisionForTag({}, 'candidate')).toThrow(/describe payload has no status\.traffic/);
  });
});

describe('journey-expectations — what the smoke must find', () => {
  const journey = {
    screens: [
      { blocks: [{ component: 'prompt', props: { heading: 'One' } }] },
      { blocks: [{ component: 'compare-set', props: {} }, { component: 'prompt', props: { heading: 'Two' } }] },
    ],
  };

  it('returns a heading for every screen, in journey order', () => {
    expect(expectationsFor(journey)).toEqual(['One', 'Two']);
  });

  it('grows automatically when the journey grows', () => {
    // This is the property that stops smoke coverage silently drifting away from the journey it
    // claims to cover — the ADR 0007 trigger-to-revisit.
    const bigger = { screens: [...journey.screens, { blocks: [{ component: 'prompt', props: { heading: 'Three' } }] }] };

    expect(expectationsFor(bigger)).toHaveLength(3);
  });

  it('de-duplicates repeated headings', () => {
    const repeated = { screens: [journey.screens[0], journey.screens[0]] };

    expect(expectationsFor(repeated)).toEqual(['One']);
  });

  it('refuses a journey with no screens rather than asserting nothing', () => {
    expect(() => expectationsFor({ screens: [] })).toThrow(/no screens/);
  });

  it('refuses a journey where SOME screen carries no prompt heading, naming that screen', () => {
    // The hole the docs claim closed: the derivation is heading-only, so a headingless screen is
    // one the smoke never looks at while the workflow says it walked every screen. Silently
    // returning the other screens' headings is what made that claim false, so the screen is named
    // and the run stops.
    const mixed = {
      screens: [
        { id: 'covered', blocks: [{ component: 'prompt', props: { heading: 'One' } }] },
        { id: 'quiet', blocks: [{ component: 'status', props: {} }] },
      ],
    };

    expect(() => expectationsFor(mixed)).toThrow(/carry no prompt heading/);
    expect(() => expectationsFor(mixed)).toThrow(/quiet/);
  });

  it('names an unidentified screen by its position rather than saying nothing useful', () => {
    expect(() =>
      expectationsFor({
        screens: [
          { blocks: [{ component: 'prompt', props: { heading: 'One' } }] },
          { blocks: [{ component: 'status', props: {} }] },
        ],
      }),
    ).toThrow(/#2/);
  });

  it('refuses a journey whose screens carry no prompt heading', () => {
    // Returning an empty list would make the smoke pass against any page at all.
    expect(() => expectationsFor({ screens: [{ blocks: [{ component: 'status', props: {} }] }] })).toThrow(
      /no screen carries a prompt heading/,
    );
  });
});

describe('journey-expectations.mjs — CLI usage-error guard', () => {
  it('refuses to run with no journey path, rather than reading undefined as a path', () => {
    const r = runJourneyExpectationsCli([]);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('usage: journey-expectations.mjs <path-to-journey.json>');
  });
});
