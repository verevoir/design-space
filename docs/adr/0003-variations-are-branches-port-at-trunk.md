# ADR 0003 — Journey variations are branches; the port is read at trunk

**Status:** accepted, 2026-08-11

## Context

Four variations of a journey are mostly identical — the same screens, one reordered. They need
lineage ("this came from asking the postcode first"), history, revert, and cheap culling.

An early objection to using git branches was that the grid shows all four variations at once
while a working tree is one branch at a time. That objection was **wrong**: rendering reads at a
ref and never checks anything out, and fanned work already wants a worktree per unit.

## Decision

A journey variation is a **branch**. Lineage is the merge-base, the diff against it is what
changed, and culling a column is deleting a branch.

The **port, adapters and token sets are read at trunk**, not at the variation's ref.

Propagating a change across variations is an **explicit** operation (a cherry-pick), never
automatic inheritance.

## Alternatives rejected

- **Four full copies on one branch.** Rejected: no lineage, and a label fix drifts silently
  across variations.
- **Base + patch documents resolved at render time.** Rejected: this is rebasing with a
  bespoke implementation, and its failure modes would surface mid-workshop.
- **Branching the whole tree per variation, port included.** Rejected: the port would diverge
  per column, every column would drift to its own vocabulary, and the comparison would quietly
  stop meaning anything. This is the reason for the trunk rule.
- **Automatic inheritance from a parent variation.** Rejected: in a tool whose purpose is a
  live conversation, predictable beats DRY. A cell changing because of an edit three columns
  away is exactly the surprise that destroys trust in the grid.

## Consequences

- The "what changed and why" line — *"postcode first, so we can pre-fill the address"* — is the
  commit message, and costs nothing extra.
- Reading at a ref (ADR 0002) is load-bearing, not incidental.
- A conflict on an explicit cherry-pick is genuine information about how far two variations have
  diverged.

## Trigger to revisit

If propagation across variations becomes routine rather than occasional, the variation model is
wrong and shared-fragment composition should be reconsidered.
