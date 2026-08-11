# ADR 0005 — Phase 1 depends on no unfinished runner work

**Status:** accepted, 2026-08-11

## Context

The natural home for design-space's chat, storage and fan is cloud-runner's stateless-agent
work: conversations as the unit of work, a staged per-conversation write overlay, and a fan with
fork/contract/join.

As briefed on 2026-08-11, that work resolves to **half available**. Hosting is exported —
`createRunnerHost`, `createRunnerLoop`, `createTurnStore` and the object stores, with a real
exports map. Fanning is not: nothing from `src/fan/` is on the public surface, and exporting it
would not help, because that module deliberately does not publish claims — that is the
dispatcher's job, and the dispatcher lives above the host. Still outstanding are a composition
root on main, writers in the toolbelt, and a `GateRunner` implementation.

## Decision

Phase 1 depends on **none** of it. The fan comes from `@verevoir/recipes/engine`, which is
available now and decoupled. Writes go through the accelerator behind a narrow port. The gate is
structural and needs no `GateRunner`. The chat is the operator in Claude Code against a
watching dev server.

The phase order is:

1. **Phase 1** — journey model, induced port, sketch adapter, the grid, git-backed store, the
   pipeline on `recipes/engine`, the structural gate.
2. **Phase 2** — conversation-addressed storage and in-page chat, when the runner work lands.
3. **Phase 3** — real external design-system adapters, where non-renderable cells become
   findings rather than bugs.

## Alternatives rejected

- **Wait for the runner.** Rejected: phase 1 contains all the taste-gated work, which is the
  part that cannot be parallelised or hurried, and none of it needs the runner.
- **Build our own fan.** Rejected: `recipes/engine` already supplies plan → gate → layer →
  execute-concurrently with the enactment injected, and its header states it is there to be
  driven.
- **Build our own conversation store now, to swap later.** Rejected as speculative generality.
  ADR 0002's resolver seam is the whole of what phase 2 needs from phase 1.

## Consequences

- design-space is a second consumer of `recipes/engine` on work that is not code review, which
  is how it becomes clear whether the abstraction is real or shaped around one use case.
- The structural gate may be a worked example of a **non-testimonial** gate, which is the
  property the `GateRunner` card records as missing elsewhere.
- Phase 2 adoption is a resolver swap plus a chat surface, not a re-architecture.

## Trigger to revisit

A composition root on cloud-runner's main, toolbelt writers, and a `GateRunner` implementation —
at which point phase 2 is unblocked and should be scheduled rather than drifted into.
