# ADR 0009 — Review verdicts are not deterministic; take the union of findings, never the favourable run

**Status:** accepted, 2026-08-17

## Context

The `antagonistic-review` gate runs five LLM-driven lenses against a pull request's head and
fails closed if any lens rejects. It is treated, and documented, as the check that decides.

On 2026-08-17, commit `c833795` was reviewed under two separate PR contexts at once — PR #11 and
PR #14, which briefly shared that head after a fast-forward push overtook a branch-rename
workaround. Two independent check-run suites ran against the identical tree, distinguishable by
their own cache-key annotations (`...pr-11-...` vs `...pr-14-...`). They disagreed:

- The suite tied to PR #11's context: `antagonistic-review` **success**, all five lenses clean.
- The suite tied to PR #14's context: `antagonistic-review` **failure** — `review (docs)`
  rejected, citing a real duplication finding (the same rationale restated near-verbatim across
  three test files, twice within one of them).

Same commit, same tree, same lens configuration, opposite conclusions. The finding itself was
genuine — it was fixed on the strength of the failing run — which rules out "the failing run was
simply wrong." The lenses are not deterministic against identical input.

## Decision

**When two runs of `antagonistic-review` against the same content disagree, treat the union of
every finding from every run as the verdict — never the most favourable run, never the most
recent one, never a majority vote.** A rejection found in any run stands until it is addressed,
regardless of how many parallel or subsequent runs pass clean.

The reasoning is that selecting the green run is indistinguishable, from the outside, from
re-running the gate until it happens to pass. A gate whose failures can be discarded by waiting
for a better roll is not an antagonistic gate; it is a formality with occasional cost. Taking the
union is the only rule under which a real finding cannot be made to disappear by chance.

## Alternatives rejected

- **Trust the most recent run.** Arbitrary — nothing about recency bears on whether a finding is
  real, and it would make outcome depend on scheduling order between suites, which is exactly the
  race that produced this ADR.
- **Trust the majority of N runs.** Requires deliberately running the panel multiple times per
  change, which spends real review cost on every PR to buy a statistic from a sample of two or
  three — not enough to be a majority in any meaningful sense, and cost this repository has
  reason to avoid (`AGENTS.md`'s own note that a local pregate run costs real money).
- **Treat a single pass as sufficient, single failures as noise to be re-run away.** This is the
  status quo the incident exposed as unsafe: it is exactly "re-roll until green."

## Consequences

- A finding surfaced in any run of `antagonistic-review` against a given tree must be answered
  before that tree merges, even when a parallel or later run of the identical tree came back
  clean.
- The panel becomes strictly conservative rather than a coin flip: it can now cost an
  unnecessary fix when a finding turns out not to reproduce, but it can no longer be made to pass
  by chance alone.
- Operationally, this means whoever is watching a board that shows two suites against one sha
  must read both rather than reporting whichever concluded first or most favourably.

## Trigger to revisit

If the source of the non-determinism becomes understood and bounded — a fixed seed, a
deterministic model configuration, or the two-suite race itself turns out to be the true cause
rather than the lens's own variance — this decision should be revisited against whatever
guarantee replaces it. Also revisit if divergent-run findings prove frequently spurious in
practice, which would argue for some reproduction step before a union finding blocks a merge.
