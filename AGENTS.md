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

- **Run the review panel locally before pushing.** PRs otherwise take several rounds; the local
  run exists to bring that number down, not to replace CI. It lives outside this repository, in
  the capabilities project alongside it, and can be run by hand:

  ```sh
  PREGATE_PI_CONFIG=<the Claude config file holding your model credentials> \
    node ../capabilities/scripts/run-pregate.mjs --base main
  ```

  The config path is machine-specific and deliberately not written down here — a literal path
  from one operator's laptop is wrong for everyone else and unverifiable from this repository.

  About five minutes and a couple of dollars — cheap against a CI round trip, and it runs the
  same five lenses.

  The same script is also declared as the `pregate` release step in `aigency.json`, so it can be
  driven through `run_release_step` instead of typed by hand — both paths invoke
  `../capabilities/scripts/run-pregate.mjs`, and neither replaces the other. The declared step
  needs `CLAUDE_CODE_OAUTH_TOKEN` (model credentials, replacing `PREGATE_PI_CONFIG` for that
  invocation) and `AIGENCY_GUARDRAILS_TOKEN` (reads the provisioned rubric and publishes each
  lens's verdict). A declaration's `env` list names variables, not values, so both must actually
  be exported in the runtime's own process and listed in that runtime's `AIGENCY_ALLOWED_ENV`
  before `aigency.json` naming them has any effect — the file cannot grant an environment variable
  that was never exported.

  The declared step also passes `--lens-timeout 900`, wider than the script's own 180-second
  default. `correctness` was seen to exceed 180s and come back with no verdict at all rather
  than a slow one; the flag's deadline is shared with the retry, so 900s has to cover both the
  first attempt and one retry, not just a single try.

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
