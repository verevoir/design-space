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

**Width:** fans to 2 after wave 0, narrows to 1 for 2S.1, then fans to 2 again — the deployment
chain `2S.2 → 2S.3 → 2S.4` runs alongside wave 2, because it writes `studio`, `Dockerfile` and
`.github/` while wave 2 writes `port`. Wave 3 then fans to 3.
**Critical path:** `0.1 → 1.1 → 2S.1 → 2.1 → 3.1 → 4.2 → 5.1 → 6.1` — eight stories, so seven
edges, each a genuine dependency rather than narrative order. The deployment chain is three
stories long and is not on that path; it finishes well inside it.

This file is the tracker (see `AGENTS.md`). A story carries a **Status** line once it moves, and
it is updated in the change that moves it — not afterwards.

**Status lines do not carry test counts.** Two did, and both were wrong — one overstated by ten,
the other understated by two thirds — which is what a number in prose does: it is a claim with a
shelf life of one commit, and nothing checks it. Describe what the tests cover; the suite reports
how many, and it is never out of date.

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

**Status.** Done. Zod is the single source; the TypeScript types come from `z.infer` and the
JSON Schema artefact is emitted from the same schema at build time. Structural checks cover
dangling action targets and screens unreachable from the entry point.

One defect worth remembering: the emitter was wired to a package script the root build never
invoked, so the artefact was never produced while `npm run verify` stayed green. The gate now
catches it — `artefact.test.ts` fails if the artefact is missing or has drifted from the schema.

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

**Status.** Done. Reads go through `git show` via `execFile` with argv only — no shell, no
checkout, no working-tree mutation. The resolver owns path construction; callers name an object
by kind and id. Tested against a real temporary git repository; the no-checkout guarantee is
demonstrated by reading a non-HEAD ref and confirming that neither the working-tree status nor
the index fingerprint changes (a checkout would have mutated both). Two separate tests confirm
that reading the same object at two different refs yields different content. Subprocess failures
are classified: a normal non-zero exit (git answered "not there") surfaces as
`ObjectNotFoundError`; a signal-killed subprocess (timeout or hung git) surfaces as
`ObjectLookupError`, which a caller can retry. Input is validated at the boundary: a ref, root,
or id that fails the allow-pattern is rejected with `InvalidRefError` before any subprocess is
spawned.

The fan was real: 1.1 and 1.2 were built concurrently in separate worktrees, which they needed
because both run `npm install` and would otherwise have collided on the lockfile.

---

## Wave 2S — the steel thread

One component, all the way through, deployed. Everything after this wave **widens** a chain that
already works rather than discovering whether it works at all.

**2S.1 is a barrier**: it writes `port`, `adapter-sketch`, `render` and `gate` — which waves 2 and
3 also own — and `studio`, which 2S.2 owns. One writer per target, so nothing in those waves runs
alongside it.

**2S.2–2S.4 are not.** They write `studio`, `Dockerfile` and `.github/`, so once 2S.1 lands they
run concurrently with wave 2 — they are a chain among themselves (each needs the previous one's
URL or its smoke tests) but they block nothing else, and nothing else blocks them.

### 2S.1 One component travels the whole chain

**Outcome.** A single port component — `prompt`, the simplest one the reference journey uses — is
defined as a contract, implemented by the sketch adapter, composed into a standalone document
from a journey document read through the store, and checked by the gate.

**Scope corrected 2026-08-12.** This story originally carried "and is reachable at a URL" and a
done-bar naming the deployment. That was one story doing two jobs, and it is why its status sat
at "in progress" through eleven review rounds while the code half was finished. The deployment
criteria moved to 2S.2–2S.4, which is a split, not a quiet narrowing — the URL is still required
before wave 2S is done.

**Why.** The waves as first drawn were layer-shaped: schema, then port, then adapters, then
studio. That produces a chain by construction, and it leaves deployment until last — the point at
which discovering a problem with it is most expensive. Threading one component through every
layer proves the chain, the gate and the deployment while each is still cheap to change. It also
means every later story ships to somewhere real rather than to a branch.

**Done when.** A journey read through the store renders to a standalone document in which
`prompt` is real output and every unimplemented component is a visible, labelled gap; the gate
reports coverage, gaps and defects distinctly.

**Writes.** A thin slice of `packages/port`, `packages/adapter-sketch`, `packages/render`,
`packages/gate` and `packages/studio`.
**Reads.** `packages/journey-model`, `packages/store`, `examples/journeys`.
**Unblocks.** 2S.2, which wires its two halves together, and waves 2–3, which cannot start while
it holds their write-sets.

**Status.** Done. `prompt` is defined in the port with a Zod prop schema, implemented by the
sketch adapter, rendered into a standalone HTML document, and checked by the gate, which
distinguishes a gap (missing renderer) from a defect (renderer threw) from a schema-validation
failure (the adapter was never called). `prerender` reads the journey through the store at a ref
and writes a document; the studio server serves a document handed to it. Nothing yet wires those
two into a runnable entry point — that is 2S.2.

Eleven review rounds. What they found, recorded because the pattern is the useful part: a git
argument-injection vector through an unvalidated `ref`, then the same hole through `root`, then
again through `id`; a validator admitting a character its own error message said it rejected;
three separate paths by which "could not determine" collapsed into "not there" (a timeout, a
signal kill, a `maxBuffer` overflow); two load-bearing tests silently dropped by wholesale test
file rewrites; and a `--ds-paper` token set to `#ffffff`, so the sketch adapter had been
rendering on white rather than paper.

---

### 2S.2 The rendered journey is reachable at a URL that costs nothing when idle

**Outcome.** A container serves the reference journey, rendered through the sketch adapter, at a
public URL. It scales to zero, and its idle cost is stated as a number.

**Why.** 2S.1 leaves `prerender` and the server unwired — each half is exercised only by its own
tests. This is the wiring, and it is what makes the steel thread a thread rather than two
threads.

**Done when.** The URL serves the rendered document; rendering happens at build time through the
store (ADR 0002), so the runtime image contains no git repository; the service is configured with
`min-instances=0`; and the idle cost is recorded in the architecture's operational section as a
figure, not as "cheap".

**Writes.** `packages/studio` (entry point), `Dockerfile`, deployment configuration.
**Unblocks.** 2S.3.

**Status.** Mostly done, one clause outstanding.

Delivered: `serve.ts` wires `prerender`'s output to the server and is what the container runs;
a two-stage `Dockerfile` pinned by digest, non-root, carrying no git, no devDependencies and no
source; the service deployed to Cloud Run in `europe-west2` at `min-instances=0`, authenticated
only, running as an identity with no permissions. The deployed URL serves the journey — the
`prompt` block rendered, five labelled gaps, 5689 bytes.

**Outstanding: the idle cost as a number.** The done-bar asks for a figure rather than the word
"cheap", and only a billing read supplies one. Not estimated on purpose.

Two things the deployment caught that nothing else had. The image built on Apple Silicon is
`arm64` and Cloud Run rejects it with `exec format error` at the startup probe — a passing suite
and a container that ran locally said nothing about it. And **Cloud Run intercepts `/healthz`**:
it returns a Google frontend 404 that never reaches the container, while `/health`, `/readyz`,
`/-/health` and arbitrary paths all arrive. A review lens raised exactly this; it was checked
against Google's documentation, found unsupported, and pushed back on. The deployment settled it
the other way, and the endpoint is now `/health`.

### 2S.3 Every pull request gets its own deployment, and smoke tests run against it

**Outcome.** Opening or updating a PR deploys a revision carrying no traffic under a `pr-<n>` tag,
runs smoke tests against that tag's URL, and posts the URL on the PR. Closing the PR removes the
tag.

**Why.** ADR 0007. A reviewer should be able to click the change rather than imagine it, and the
smoke tests need a real target that is not production.

**Done when.** A PR shows a working URL a human can open; smoke tests run against it and a failure
blocks; the tag is gone after the PR closes; and a fork PR degrades to "no preview" with a stated
reason rather than a failed run — deploy credentials cannot reach a fork, by the same guard that
protects the review panel.

**Writes.** `.github/workflows/`, smoke tests.

**Status.** Mostly done, one clause outstanding — three of the four done-when clauses are proved
against the real thing. The fourth, the fork path, needs a fork PR, and nobody has opened one
against this repository.

**Proved, and here is how to check it rather than take my word:** the `PR preview` workflow on
this branch has run to success on every push — see its runs under Actions, and the preview comment
it posted on PR #6, which the workflow updates in place rather than reposting. Those two artefacts
are the evidence; a URL quoted in prose is not, because a hostname in a document is
indistinguishable from a test fixture. (One was: an earlier version of this status quoted a URL
that the service-urls tests also used as a mock, so the "proof" traced to invented data even
though the deploy was real. The fixtures are now obviously synthetic.)

So "a PR shows a working URL a human can open" and "smoke tests run against it" both hold.

**Proved on merge — tag removal on close.** Until this PR merged the cleanup job had only ever
been *skipped*, so the removal had never run against Cloud Run and a test with a stubbed `gcloud`
was standing in for the claim. Merging it ran the job for real: run `31801164544` reports
`Removed tag pr-6`, with traffic left at 100% on the serving revision. The removed / already-absent
/ real-failure branches of `scripts/remove-preview-tag.sh` remain covered by tests; what the merge
added is that the removed branch has now executed against the real service.

**Not proved — the fork path.** The degraded behaviour is pinned by the workflow shape tests, but
no fork PR has ever been opened against this repository, so it has not been observed.

**On the tag-removal step itself.** It previously ended `|| echo "…nothing to do"`, which reported
success for every failure — expired credentials, a network fault, a wrong service name — leaving
the tag routing while the job went green. It now tolerates only an absent tag, judged from
gcloud's own output naming *this* tag, and fails the job on anything else.

### 2S.4 A change reaches `main` only after serving production traffic

**Outcome.** Promotion is: assert the branch fast-forwards onto `main`, deploy a `candidate`
revision with no traffic, smoke it, cut 10% of traffic to it, health-check the live service, cut
the remaining 90%, then merge. Every step is bounded by a timeout. Any failure — including a step
that exceeds its bound — removes the candidate, restores traffic to the previous revision, and
records a failed deployment.

**Why.** ADR 0007. `main` is what every later story branches from, so it must never be
known-bad; reverting a merged change is worse than never merging it.

**Done when.** A change reaches `main` only via that sequence; a deliberately broken candidate is
rolled back without traffic reaching it and without merging; a candidate that passes smoke but
fails the health check at 10% is rolled back before the remaining traffic moves; the image that
served canary traffic is the image retagged onto the merged commit rather than a rebuild; and the
merged tree is asserted equal to the canaried tree.

**Writes.** `.github/workflows/`.

**Starting conditions, measured 2026-08-14.** Three facts that change how this story is built,
recorded here so the next person does not have to rediscover them.

- **Production is running stale code, and this story is what fixes it.** Traffic sits 100% on
  revision `design-space-studio-00002`, which serves `/` but 404s `/health` because it predates
  the endpoint. Twenty-four revisions have been built and smoke-tested by previews since, and
  **none has ever been promoted** — the pipeline validates changes it never ships. So the first
  real promotion is not a rehearsal: it is the redeploy that makes the live service match its
  own source, and `/health` returning 200 on the traffic-serving revision is the proof.
- **This repository forbids merge commits, and ADR 0007 already assumes that.** Its
  "the branch must fast-forward onto `main`" is a *precondition* checked before canarying —
  `git merge-base --is-ancestor origin/main HEAD` — not a statement about the merge method. The
  ADR then designs explicitly for squash and rebase minting a new SHA: the proven image is
  retagged onto the merged commit, and the merged **tree** is asserted equal to the canaried
  tree, SHA equality having been rejected as unachievable on GitHub. So `--squash` is the
  expected landing, and the retag-and-compare is not optional detail — it is the whole reason
  the ADR can tolerate a new SHA.
- **The tagged-revision mechanism underneath this story is proved** by 2S.3: per-PR `--no-traffic
  --tag pr-<n>` deploys, smoke against the tag URL, and tag removal on close have all run against
  the real service. What is unproved is everything about *traffic* — no traffic split has ever
  been performed on this service, and no rollback has ever run.

---

**Status.** Implemented, not yet verified. `.github/workflows/promote.yml` runs the full sequence
— wait for the other checks, assert ancestry, capture a rollback target, build, deploy a
digest-pinned `candidate` revision at zero traffic, smoke, cut 10%, health-check, cut 100%,
squash-merge, assert tree equality, retag the proven digest, pin traffic and drop the tag — with
every step timeout-bounded and a rollback path guarded so it cannot move traffic after the merge.
The decision logic lives in `scripts/promote/` with tests rather than in `run:` blocks. The smoke
now walks every screen of the reference journey, derived from the journey document. ADR 0007 is
amended for the health-check divergence.

Outstanding: the gates have not been run against this change and it has not promoted anything, so
nothing here is proved. It promotes itself by carrying the `promote` label, and that is the
intended first proof.

### 2S.5 The smoke test authenticates as an identity that can only invoke

**Outcome.** Preview and canary smoke tests authenticate as a principal holding
`roles/run.invoker` on the studio service and nothing else, instead of reusing the deploy
identity's `run.admin`.

**Why.** `no-standing-auth-bypass` asks that a non-interactive credential be least-privilege.
Invoking a service needs no administrative right, and a leaked token should not be able to
redeploy or delete the thing it was meant to curl.

**Status.** Done. `ds-invoker` exists, holds `roles/run.invoker` on `design-space-studio` and
**no project-level grant at all**, and is assumable only under the same WIF condition as the
deployer. The preview workflow mints the smoke token as that identity; a shape test asserts the
minting step names the invoker and never the deployer, so the arrangement cannot quietly revert.

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

**Known gap, found 2026-08-12 by running the container rather than the suite.** `render.ts` owns the
`<style>` block through a module constant, and the `Adapter` interface has **no way to contribute
CSS at all**. So every adapter currently renders with identical styling, and
`SKETCH_CSS_CUSTOM_PROPERTIES` is dead code — defined, exported, pinned by a test file that
asserts every one of its token values, and referenced by nothing outside that test. The served
page contains no `--ds-*` properties.

That is ADR 0001's central claim unimplemented: an adapter is supposed to decide what a component
looks like. **This story must widen the `Adapter` contract to carry presentation**, not only
markup, or the sketch style cannot exist and 4.1 cannot work.

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

**Blocked on 3.1's adapter-contract widening.** A token-variant adapter changes values over shared
markup (ADR 0001's degenerate case) — which is only meaningful once an adapter can supply those
values. Today it cannot, so swapping a token set would change nothing on screen.

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
