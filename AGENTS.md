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
   disproportionate care. Provisional is now carried by typography, colour AND a hand-drawn
   (Excalidraw-style) rough outline — outline only, no drop shadow. See
   `docs/architecture.md` §5 for the mechanism and its two hard constraints — not restated here
   because a short summary of them already drifted out of sync with §5 once.

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
- **Cut every branch from current `origin/main`, never from a local `main` that may be stale.**
  A branch built on a stale base can be missing files the tree it was cut from already had —
  scripts a workflow calls, tests a suite imports — and the failure surfaces later, as a
  collection error or a missing-script error, not as an obviously wrong diff. Worse: once that
  base is squash-merged, the branch cannot be rebased onto the new `main` at all. The squash
  collapses the base's history into one commit with no ancestor the branch's own commits share,
  so a rebase sees every file the squashed work created as independently added on both sides —
  an ADD/ADD conflict on each one, not a content conflict a rebase can resolve. That is a
  structural fact about squash merges, not a mistake to fix in the rebase; the only way out is a
  fresh branch cut from the new base.

## Testing discipline

An assertion whose expected value equals what a correct implementation already produces is
unverified — the expected value and the bug-free value are the same, so the predicate is never
exercised. Gut it to a constant and confirm the suite goes red before trusting it. Worked
example: `tests/aigency-config.test.ts`'s file header.

## Operating this repo

How to *run* things here. Platform facts — the service, the identities, why the image must be
`linux/amd64`, why the health endpoint is `/health` — live in `docs/architecture.md` §9a and are
not repeated.

- **See the rendered page locally.** Two paths:
  - `docker build -t design-space-studio . && docker run --rm -p 8080:8080 design-space-studio`,
    then open `http://localhost:8080` — no local Node needed beyond Docker itself.
  - Without Docker: `npm ci && npm run build`, then regenerate the prerendered document —
    `node packages/studio/scripts/prerender-build.mjs` (also declared in `aigency.json` as the
    `prerender` query, so an agent can run it through the belt rather than a raw shell command)
    — then `node packages/studio/dist/serve.js` and open `http://localhost:8080` (`PORT`
    overrides it). Re-run the prerender step after every build; it reads the compiled `dist/`
    output and the journey at git `HEAD`, and prints a `gaps (unimplemented components):` line
    naming anything the adapter has no renderer for.
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
