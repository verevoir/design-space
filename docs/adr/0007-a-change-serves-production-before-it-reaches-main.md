# ADR 0007 — A change serves production traffic before it reaches `main`

**Status:** accepted, 2026-08-12

## Context

The ordinary shape is merge, then deploy. Its failure mode is that a bad change is already on
`main` when you find out, so recovery means a revert commit — and `main` was, for a while, not
deployable. That is the state this project most wants to avoid, because `main` is what every
later story branches from.

Cloud Run's revision model makes the inverse cheap. A revision can be deployed carrying **no
traffic** and given a **tag**, which gives it its own stable URL. Because the service scales to
zero, a revision nobody is talking to costs nothing to keep.

## Decision

**A change is deployed and exercised in production before it is merged.**

| step | mechanism |
|---|---|
| PR opens or updates | `run deploy --no-traffic --tag pr-<n>` — its own URL, zero traffic |
| verification | smoke tests run against that tag URL, and the URL is posted on the PR |
| promotion | `--no-traffic --tag candidate`, smoke the candidate at zero traffic |
| staged cut | `update-traffic --to-tags candidate=10`, health-check the live service, then `candidate=100` |
| merge | only after the full cut succeeds |
| failure at any step | `update-traffic` back to the previous revision, `--remove-tags`, and the deployment is recorded as failed |
| PR closes | the `pr-<n>` tag is removed |

**Every step is bounded.** A `run deploy`, a smoke run, a health check and an `update-traffic`
call each carry an explicit timeout, and a step that exceeds it is a failure that rolls back — not
a run that hangs. An unbounded promotion step is worse than a failed one, because it leaves
traffic in a split state with nobody watching.

Two conditions make this safe, and both are checkable rather than hoped for:

- **The branch must fast-forward onto `main` before it is canaried.** `git merge-base
  --is-ancestor origin/main HEAD` answers this in one command. If it fails, the branch is out of
  date and must not be promoted — the merge afterwards is then a formality that cannot conflict.
  Branch protection already enforces `strict: true` and `required_linear_history`.
- **The image that served traffic is the image that ships.** GitHub's squash and rebase both mint
  new commit SHAs, so the merged commit is not the one that was canaried. Rather than rebuild
  from the merged SHA — which would deploy an artefact nothing tested — the proven image is
  **retagged** onto it, and the merged tree is asserted equal to the canaried tree.

### Why the cut is staged rather than immediate

The first draft cut straight from 0% to 100% once the candidate passed smoke. That is the
`deploy-safety` reject signal — all-at-once, with defects reaching every user before detection.

The counter-argument is real and worth recording rather than hiding: smoke runs against a revision
carrying **no traffic**, so it already catches defects at zero users, and 10% of a service whose
traffic is a handful of people is not a statistical sample. A percentage step nobody watches is
theatre.

It is staged anyway, for a reason the sample size does not affect: smoke tests exercise what they
were written to exercise, and the interesting failures are the ones nobody wrote a test for. A
staged cut with a health check against the **live** service is the only step in this sequence that
observes real traffic hitting the new revision. It costs one extra command and it is the only
place an unanticipated failure can surface before it reaches everyone.

## Alternatives rejected

- **Merge then deploy.** Rejected: recovery is a revert on `main`, and `main` is briefly known-bad.
  The operator's phrasing: reverting commits is not pretty either.
- **A separate preview environment per PR** (its own service, or a second project). Rejected: a
  tagged revision on the same service already gives an isolated URL that scales to zero, so a
  separate environment would add cost and drift for no isolation gain.
- **Rebuilding from the merged commit.** Rejected: it deploys an artefact that nothing verified,
  which discards the entire point of canarying first.
- **Requiring SHA equality between canary and `main`.** Rejected as unachievable on GitHub without
  disabling squash and rebase entirely. Tree equality is the property that actually matters and
  it is checkable.

## Consequences

- `main` is always deployable, because nothing reaches it that has not already served traffic.
- A failed change never lands, so there is no revert to write and no window where `main` is bad.
- **Fork PRs get no preview.** Deploys need credentials, and the same fork guard that stops the
  review panel reaching org secrets applies here. This repository is public, so fork PRs will
  happen; a missing preview URL on one is expected, not a broken pipeline.
- Preview tags must be removed when a PR closes, or they accumulate against Cloud Run's
  per-service revision and tag limits.
- Smoke tests become load-bearing rather than decorative: they are the only thing standing between
  a canary and production traffic. This is the `journey-smoke-coverage` practice, which already
  asks for exactly this — each documented journey exercised against the freshly-deployed,
  no-traffic revision **before** traffic shifts.

## Trigger to revisit

If the promotion sequence is ever bypassed under time pressure — a direct deploy, or a merge
before the traffic cut — that is the signal the sequence is too slow, and the fix is to make it
faster rather than to route around it. Also revisit if smoke coverage stops tracking the journeys
it claims to cover, since the whole ordering rests on those tests meaning something.
