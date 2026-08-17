# design-space — agent context

A tool for holding **two design conversations without letting either contaminate the other**:
the journey conversation (which screens, in what order, what happens when you click) and the
design system conversation (the same journey, expressed differently). The product mechanic is
holding one axis still to talk about the other.

## Read these first, in this order

| | |
|---|---|
| `docs/architecture.md` | what the parts are and how they fit. Start here. |
| `docs/adr/` | why they are that way, and what was rejected. |
| `backlog.md` | the phase 1 stories, numbered into waves. |
| `examples/journeys/` | the reference journey the component port is induced from. |

This file keeps **no copy** of what those say. If you need the reasoning behind a shape, the ADR
is the source; if this file and an ADR disagree, the ADR wins and this file is wrong.

## The five things that are easy to get wrong

1. **A journey document may not name a design system, and an adapter may not know which journey
   it is rendering.** That separation is the entire product. Everything else is a consequence.
2. **The port is induced from real journeys, never designed a priori** (ADR 0001). Its size is
   multiplied by every design system that will ever exist, so merging near-duplicates is worth
   real effort. Within a session it may gain components; it may not lose or rename them.
3. **Read the port and adapters at trunk, journeys at the variation's ref** (ADR 0003). Branch
   the whole tree per variation and every column drifts to its own vocabulary, at which point
   the comparison quietly stops meaning anything.
4. **Nothing above the resolver constructs a path** (ADR 0002). That seam is the whole of what
   phase 2 needs from phase 1.
5. **The sketch adapter is the editing surface, not a peer of the other adapters.** It gets
   disproportionate care. Provisional is carried by typography and colour — handwriting face,
   warm paper, ink rather than black, one hard offset shadow — never by wobbly geometry, which
   fights every layout and gets twee at scale.

## Working discipline

- **`backlog.md` is this project's tracker**, deliberately — not the Notion work tracker that
  holds aigency's own state. Story status is updated in the file, in the change that moves it.
  Revisit if design-space acquires contributors beyond the operator, or when it moves out of
  `aigency/projects/`.
- **Pull the bar before implementing or decomposing.** `provision` from the verevoir
  capabilities MCP, with a short description of the work. Planning is governed too.
- **Route substantial work rather than hand-writing it.** `enact_capability` for
  capability-shaped work; `dispatch` for a task a worker can drive over this source. A small,
  surgical edit is the exception, not the rule.
- **Read and write through the verevoir accelerator MCP**, not the built-in file tools — a write
  that bypasses it leaves the shared cache stale for the rest of the session.
- **One story, one wave, disjoint write-sets.** The wave numbering in `backlog.md` states merge
  order and concurrency; siblings in a wave must not write the same package.
- **Keep the seams repo-shaped** (ADR 0004). The test of a correct boundary: could this package
  be published and consumed from another repository without moving code?

## Operating this repo

How to *run* things here. Platform facts — the service, the identities, why the image must be
`linux/amd64`, why the health endpoint is `/health` — live in `docs/architecture.md` §9a and are
not repeated.

- **Cut every branch from current `origin/main`, immediately after the previous branch merges,
  not from whatever a stale local clone happens to have checked out.** After a squash merge,
  the merged PR's individual commits have no shared history with `main`'s new tip — `main` now
  holds one new commit, not the branch's history — so a branch cut from the pre-merge base
  cannot later be *rebased* onto the new `main`: every file the squashed PR touched looks
  independently added on both sides, an ADD/ADD conflict that is structural, not a merge
  accident. It can only be re-cut. Worse, the symptom is not a prompt conflict: a stale-base
  branch's diff against `main` silently carries the WHOLE of the already-merged PR alongside the
  real change, which can be large enough to blow the review panel's diff-size cap and truncate
  — five lenses timing out together on what looks like a two-file change, with nothing in the
  output naming a stale base as the cause. If a rebase reports "already on top of main" for a
  branch that should not be, distrust it and re-check against `origin/main` explicitly rather
  than a local `main` ref, which can itself be stale.
- **Run the review panel locally before pushing.** PRs otherwise take several rounds; the local
  run exists to bring that number down, not to replace CI. It lives outside this repository, in
  the capabilities project alongside it:

  ```sh
  PREGATE_PI_CONFIG=<the Claude config file holding your model credentials> \
    node ../capabilities/scripts/run-pregate.mjs --base main
  ```

  The config path is machine-specific and deliberately not written down here — a literal path
  from one operator's laptop is wrong for everyone else and unverifiable from this repository.

  About five minutes and a couple of dollars — cheap against a CI round trip, and it runs the
  same five lenses.

- **The pregate run is bounded by three nested timeouts. This is their one complete derivation —
  `aigency.json` and `scripts/verified-pregate.mjs` each restate only the ordering that matters
  to reading their own number, and point back here rather than repeating this.**

  1. **The panel's own inner backstop** (`PREGATE_TIMEOUT_MS`, default 30 minutes, hardcoded in
     `../capabilities/scripts/run-pregate.mjs`) fires FIRST by design. `--lens-timeout 480`
     gives it a worst case of three sequential 60s-bounded setup calls (3 min), rubric
     provisioning bounded by one lens deadline (8 min), and two lens deadlines run behind it in
     parallel (16 min) — 3 + 8 + 16 = 27 minutes, inside the 30-minute bound with real margin.
     Firing first is what lets a run report *which lens* hung.
  2. **This wrapper's own spawn bound** (`DEFAULT_SPAWN_TIMEOUT_MS`, 35 minutes,
     `scripts/verified-pregate.mjs`) sits deliberately above layer 1, so the panel's own
     backstop gets the chance to fire and name a lens before the wrapper gives up on the whole
     spawn. On firing, the wrapper kills the ENTIRE process group it spawned, not merely the
     immediate child — a hung run must not keep making paid model calls after the wrapper has
     already reported failure. `PREGATE_SPAWN_TIMEOUT_MS` / `PREGATE_KILL_GRACE_MS` override the
     bound and its SIGTERM→SIGKILL escalation grace, for tests.
  3. **The declared release step's own `timeoutMs`** (`aigency.json`'s `pregate` row, 40
     minutes) sits deliberately above layer 2, as the final backstop. It is the only layer of
     the three that gives no diagnostic at all when it fires — the runner simply kills the
     process — which is exactly why layers 1 and 2 both exist to fire first, each with a
     message naming what happened.

- **Read the panel's findings from the run artifacts, not the check annotations.** An annotation
  is a one-line summary; the artifact carries the whole finding, with file and line.

  ```sh
  gh run download <run-id> -R verevoir/design-space -D verdicts
  # verdicts/verdict-<lens>/verdict.json
  ```

- **Pass `--account=` on every `gcloud` call.** The machine's active account belongs to a
  different organisation and holds nothing here, so a call without it fails on permissions in a
  way that reads like a missing grant rather than the wrong identity. The account that holds this
  project is the one in the commit trailers.

## Where this sits

Inside `aigency/projects/` for now, and expected to move to a project focused on the development
pipeline. It is a **dispatcher** in the aigency architecture — it drives
`@verevoir/recipes/engine` and publishes its own claims. It is deliberately not a cloud-runner
consumer in phase 1 (ADR 0005).

Governance is the aigency guardrails corpus, as for every project here. Pull it with `provision`
rather than restating it.
