# ADR 0004 — A monorepo whose seams are sized to become repositories

**Status:** accepted, 2026-08-11

## Context

design-space is expected to move out of aigency into a project focused on the development
pipeline. Its parts also have genuinely different change-cadences: the journey model changes
rarely; the studio changes constantly; an adapter changes when its design system does, and will
eventually be owned by whoever owns that design system.

Splitting into repositories now would pay the distribution tax before any of that divergence has
been demonstrated. Ignoring it would produce a tree that cannot be split when the move comes.

## Decision

One repository, under `aigency/projects/design-space`, with **package boundaries drawn where a
repository boundary would eventually fall**. Each package has its own manifest, a one-way
dependency edge, and no deep imports across packages.

## Alternatives rejected

- **A repository per package now.** Rejected: no divergence has been demonstrated yet, and the
  overhead would be paid every day for a benefit arriving once.
- **A flat `src/` with no internal boundaries.** Rejected: the move out is anticipated, so the
  seams have a known future consumer — the divergence is real even though the split is not yet
  needed.

## Consequences

- The test of a correct boundary is: *could this package be published and consumed from another
  repository without moving code?* If not, the seam is in the wrong place.
- Cross-package access is through each package's public entry point only, so the eventual split
  is a packaging change rather than a refactor.
- Concurrent stories can own disjoint packages, which is what lets the backlog fan.

## Trigger to revisit

The move into the pipeline project — or the first time two packages must change together for
the same reason twice running, which would mean the seam between them was never real.
