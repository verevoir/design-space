# design-space — phase 1 backlog

Phase 1 is everything that depends on no unfinished runner work (ADR 0005): the journey model,
the induced port, the sketch adapter, the grid, git-backed storage, the pipeline, and the
structural gate. Phase 2 (conversation-addressed storage, in-page chat) and phase 3 (real
external design systems) are not planned here.

## How to read the numbering

A shared integer is one **wave**: those stories are siblings off a common base, may be built at
the same time, and hold disjoint write-sets. An increment is a real **barrier** — everything in
the previous wave lands before the next begins. The numbering states merge order, not branch
topology.

**Width:** fans to 2 after wave 0, and to 3 after wave 2.
**Critical path:** `0.1 → 1.1 → 2.1 → 3.1 → 4.2 → 5.1 → 6.1` — seven edges, each a genuine
dependency rather than narrative order.

This file is the tracker (see `AGENTS.md`). A story carries a **Status** line once it moves, and
it is updated in the change that moves it — not afterwards.

The two barriers that matter are both **contracts**, and they are why the plan fans at all:
wave 1 settles the journey schema and wave 2 settles the port, so the three stories in wave 3
never have to guess either.

---

## Wave 0 — the tree runs

### 0.1 The repository builds, tests and lints from a clean clone

**Outcome.** Someone who clones this repository can install, build, run the tests and run the
linter with no setup ritual and no machine-specific steps. The package boundaries of
`docs/architecture.md` §9 exist as empty, wired packages, each with its own manifest and a
one-way dependency edge.

**Why.** Every other story writes into one of those packages, and a boundary that has to be
invented per story will not survive the split ADR 0004 anticipates.

**Done when.** A clean clone reaches green on build, test and lint in one documented command;
importing across a package boundary works through its public entry point and a deep import
fails.

**Writes.** Repository root, every package manifest.
**Unblocks.** Everything.

**Status.** Done. Nine packages wired with one-way TypeScript project references in dependency
order; `npm run verify` runs build → test → lint from a clean install on Node 20+. Deep imports
are blocked by an eslint `no-restricted-imports` pattern over `@design-space/*/**` and by each
package's single `"."` exports entry. The boundary test drives ESLint programmatically over a
deep import and a clean one; removing the rule was confirmed to turn it red.

---

## Wave 1 — the first contract

### 1.1 A journey document has a declared shape, and invalid ones are rejected

**Outcome.** The shape of a journey document — screens, blocks, actions with weight and target,
annotations — lives in a machine-readable schema, and a document is validated against it at the
boundary rather than by hand-written per-field checks. Both reference journeys validate; and a
document that is missing a required field, carries a dangling action target, uses an unknown
action weight, or contains a screen that no action and no entry point can reach is rejected with
a message naming the offending path.

**Why.** This is the contract every later story reads. It is also what makes a generated journey
checkable rather than hopefully parsed — the same property the port gets in wave 2.

**Done when.** `examples/journeys/*.json` validate; the four rejection cases above each produce a
locating error; the schema is the single source the validator and the published types derive
from, so they cannot drift.

**Writes.** `packages/journey-model`.
**Unblocks.** 2.1, and through it everything downstream.

### 1.2 Any object resolves at a ref through a single resolver

**Outcome.** Journey documents, the port, adapters and token sets are all read as
`(object, ref)` through one resolver. Reading four refs at once needs no working-tree change and
no checkout.

**Why.** ADR 0002. Retrofitting a ref through a rendering pipeline afterwards would mean
touching every call site in the renderer, the gate and the pipeline.

**Done when.** Two different refs of the same object are read in one process and return different
content; nothing above the resolver constructs a path; a missing `(object, ref)` fails with an
error naming both.

**Writes.** `packages/store`.
**Reads.** Nothing — deliberately independent of 1.1, which is what lets these two run together.

---

## Wave 2 — the second contract

### 2.1 A component port is induced from the reference journeys

**Outcome.** A component vocabulary is derived from the journeys in `examples/journeys/`, jointly
rather than per-journey, and published as contracts with declared prop shapes. Near-duplicates
are merged. The port is in the low tens, not the low hundreds.

**Why.** ADR 0001. The port is the contract wave 3's three stories all consume, and its size is
multiplied by every design system that will ever exist, so merging is worth real effort here.

**Done when.** Both reference journeys are expressible entirely in the induced port with no
leftover blocks; inducing from the two journeys together yields one vocabulary rather than two;
the port carries a version identifier that adapter output can be keyed on; adding a component is
possible and removing or renaming one within a session is refused.

**Writes.** `packages/port`.
**Reads.** `packages/journey-model`, `examples/journeys`.
**Unblocks.** 3.1, 3.2, 3.3 — this is where the plan fans to three.

---

## Wave 3 — three siblings off the port

All three consume the port contract and nothing of each other. 3.2 renders against the port, not
against any particular adapter, which is what keeps it a sibling of 3.1 rather than a successor.

### 3.1 The sketch adapter renders every component in the port

**Outcome.** A hand-drawn adapter implements the whole port. The rendering reads as provisional
through typography and colour — handwriting face, warm paper, ink rather than black, one hard
offset shadow, straight geometry — and stays legible with content of arbitrary length.
Annotations render as margin notes.

**Why.** This is the editing surface and the default, not a peer of the other adapters
(architecture §5). A mediocre theme render is a shrug; a mediocre sketch render breaks the
conversation the tool exists to have.

**Done when.** Every port component renders with no escape hatch; both reference journeys render
end to end; a screen whose text is three times longer than the reference still reads; and the
output has been looked at and accepted by eye — this story has a taste bar that no automated
check stands in for.

**Writes.** `packages/adapter-sketch`.
**Note.** The one story in phase 1 that is not bulk work.

### 3.2 A journey and an adapter compose into one standalone document

**Outcome.** Given a journey and any adapter implementing the port, the result is a single
self-contained document that can be opened on its own — its own scroll, its own history, its own
navigation between screens by following action targets.

**Why.** A cell in the matrix is a real site rather than a picture of one, and isolation is what
lets a phase 3 external design system bring its own CSS without fighting its neighbours.

**Done when.** A journey renders through a stub adapter with no reference to any real one;
following an action target moves between screens within the document; two documents rendered
from different adapters in one page do not affect each other's styling.

**Writes.** `packages/render`.

### 3.3 The structural gate reports coverage, resolution, escape hatches and contrast

**Outcome.** A check reports, for an adapter and a port: which port components it implements,
which rendered components fell back to an escape hatch, which referenced tokens do not resolve,
and where contrast fails the declared bar. It attests to nothing it has not counted.

**Why.** Design has no red/green check for taste, and this does not pretend otherwise
(architecture §7). Everything here is countable, which is why it needs no `GateRunner` and no
agent testimony.

**Done when.** An adapter missing a component is reported as missing; an adapter that renders a
component via a fallback is reported as an escape hatch rather than as coverage; a token
reference with no definition is located; the output distinguishes a *gap* (a finding about a
design system) from a *defect* (a finding about the adapter).

**Writes.** `packages/gate`.

---

## Wave 4 — the cheap axis, and the view

### 4.1 Token-variant adapters carry the airy-versus-dense conversation

**Outcome.** At least two adapters that reuse the sketch adapter's markup and change only token
values, so that "it is a bit crowded, can we try something lighter" is answerable by swapping a
token set. They render visibly unfinished — not shipped-looking.

**Why.** This is the design conversation actually being asked for, and it is nearly free
(ADR 0001's degenerate case). A polished render would imply decisions — imagery, microcopy,
real spacing — that have not been made.

**Done when.** Both variants pass the wave 3.3 gate with full coverage and no escape hatches;
switching between them changes no markup; the contrast check passes for each.

**Writes.** `packages/adapter-tokens`.

### 4.2 The matrix shows journeys against design systems as isolated cells

**Outcome.** A grid with journey variations across and design systems down, each cell an isolated
rendered document. Cells are static when zoomed out and become live on zoom-in. Clicking through
one cell moves every cell in that **column** in lockstep; cells in other columns do not move.

**Why.** The two axes are not alike (architecture §4): down a column the structure is identical
so sync is honest, while across columns there is no shared step 2 and sync would be a lie.

**Done when.** A grid of at least two journeys by three design systems renders; zoomed out, no
cell is live; zoom-in makes exactly one cell live; advancing a screen in one cell advances its
column and nothing else; a row or column can be culled from the view.

**Writes.** `packages/studio`.
**Reads.** `packages/render`, `packages/store`.

---

## Wave 5 — editing, and regeneration

### 5.1 A journey can be edited in sketch mode without the design systems visible

**Outcome.** A mode showing one journey as a horizontal walkthrough in the sketch adapter only,
in which screen order changes, controls are added and removed, action targets are set, and
annotations are written. The design systems are **hidden** in this mode, not merely small.

**Why.** The value of low fidelity is that it withholds information so feedback arrives at the
resolution being worked at. A themed cell visible during a flow discussion reimports exactly the
distraction the sketch was protecting against.

**Done when.** Screen order can be changed and the walkthrough reflects it; an action's target
can be repointed and following it goes to the new screen; the result still validates against the
wave 1.1 schema; no design system output is reachable from this mode without leaving it.

**Writes.** `packages/studio`.

### 5.2 A journey edit regenerates only what it invalidated

**Outcome.** A journey edit produces a plan — what recomposes, which port components are new,
which cells are stale — which is layered (port before adapters before renders) and executed
concurrently on `@verevoir/recipes/engine`. Adapter output is content-addressed on
`(port version, component, system)`, and only misses are generated.

**Why.** Cost is not the constraint; latency in a live room is. And regeneration must not change
what nobody edited: adapter markup is model-generated, so an untouched cell that shifts during a
workshop destroys trust in the grid.

**Done when.** An edit that introduces no new component performs no adapter work; an edit that
introduces one causes work proportional to `new components × systems` rather than
`port × systems`; re-running an unchanged edit produces byte-identical adapter output; the plan
states what it will do before doing it.

**Writes.** `packages/pipeline`.

---

## Wave 6 — the loop closes

### 6.1 A variation is created, compared and culled as a branch

**Outcome.** A journey variation is created as a branch carrying one sentence of rationale, is
rendered alongside its siblings in the matrix, can be compared against its parent as a diff, and
can be culled. The port and adapters are read at trunk throughout, so no variation can drift to
its own vocabulary.

**Why.** ADR 0003. This is the mechanic the whole tool exists for — branch a couple of variations
off a starting design, look across them, kill the ones that lose.

**Done when.** Creating a variation from the base journey and reversing its screen order yields
the postcode-first document; all live variations render in one grid without any checkout;
the rationale sentence is recoverable and displayed; deleting a variation removes its column and
is recoverable from history; the port is byte-identical across every column.

**Writes.** `packages/store`, `packages/studio`.

---

## Not in phase 1

Recorded so they are deferred deliberately rather than forgotten (ADR 0005, architecture §10):
screen states, conversation-addressed storage, in-page chat, external design-system adapters,
and propagating an edit across variations.
