# ADR 0001 — A design system is an adapter over a component port, not a token theme

**Status:** accepted, 2026-08-11

## Context

The first shape considered was one generated component library plus *n* token sets: a journey
rendered in five design systems would be the same markup under five different CSS custom
property scopes. Rows would then be free — a theme change is a class swap — and only journey
edits would cost anything.

That holds exactly as long as design systems differ only in **token values**. They do not. A
system whose primary action lives in a fixed bottom bar, or whose confirmation pattern is
structurally its own, cannot be reached by changing values over someone else's markup.

## Decision

The induced component library is a **port**: a set of component contracts with declared prop
shapes. A design system is an **adapter** implementing that port, free to emit whatever markup
it likes.

A token-only variation ("lighter, more airy") is a **degenerate adapter** that reuses the sketch
adapter's markup and supplies different values. The cheap path survives; it is no longer the
only path.

## Alternatives rejected

- **Shared markup + token themes only.** Rejected: cannot express structural divergence, which
  is exactly what a real external design system brings. Retained as the degenerate case.
- **A fixed, a-priori role vocabulary** (a canonical list of ~10 component roles). Rejected:
  too coarse to render well, and any richer version becomes a design system with extra steps,
  at which point the portability being bought has evaporated. The vocabulary is induced from
  real journeys instead.
- **Storing adapter markup as JSON templates**, so everything is data. Rejected: that is a
  worse React. Tokens are data; adapters are code.

## Consequences

- The implementation surface is `components × systems`. Extraction must merge near-duplicates
  aggressively; the port belongs in the low tens.
- Adding a design system stops being a token file and becomes an implementation of every port
  component — which is why phase 3 is priced separately from phases 1 and 2.
- A gate becomes possible that is not taste-shaped: **coverage** of the port by an adapter is
  countable, and so is a fallback to an escape hatch.
- Where an adapter genuinely cannot implement a component, the gap is a finding about that
  design system rather than a defect in design-space.

## Trigger to revisit

If, after three real external design systems, no adapter has needed markup that differs
structurally from the sketch adapter's, the port is over-built and should collapse back toward
tokens.
