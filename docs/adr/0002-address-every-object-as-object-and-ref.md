# ADR 0002 — Every object is addressed as `(object, ref)` through one resolver

**Status:** accepted, 2026-08-11

## Context

Journey documents, the port, adapters and token sets are all read many times per render and are
versioned differently from one another. Separately, cloud-runner is moving to a
**conversation-addressed** model: an immutable committed layer keyed `(sourceUrl, sha, path)`
with a mutable per-conversation overlay keyed `(conversationId, path)`, where a read hits the
overlay and falls back to the immutable layer.

design-space does not depend on that today (ADR 0005), but it will want it, and retrofitting an
addressing model through a rendering pipeline is miserable.

## Decision

Every object is addressed as **`(object, ref)`** and resolved through a single resolver from the
first commit. Nothing above the resolver constructs a path or opens a file directly.

## Alternatives rejected

- **Direct filesystem paths.** Rejected: cannot express "this journey at the variation's ref,
  the port at trunk", which ADR 0003 requires on every render.
- **Waiting for the overlay model to land and adopting it then.** Rejected: it would mean
  threading a ref through every call site after the fact, across the renderer, the gate and the
  pipeline.

## Consequences

- Reading four variations simultaneously needs no working-tree changes and no worktrees.
- Adopting conversation-addressed storage later is a **resolver swap** — overlay first,
  immutable base second — and nothing above it changes.
- The resolver is the one place caching, content-addressing (architecture §8) and ref pinning
  live, rather than being spread across consumers.

## Trigger to revisit

If the resolver acquires behaviour beyond resolution and caching — policy, transformation,
validation — it has become a god object and should be split.
