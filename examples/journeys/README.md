# Reference journeys

These exist so the component port can be **induced from real journeys** rather than designed a
priori (ADR 0001). They are an input to the work, not a demonstration of it.

The journey is invented — a broadband switch — but it is shaped like a real one: a comparison,
a check with a pass/fail result, an optional multi-select, a form, and a review with edit paths.

## The two files

| file | what it is |
|---|---|
| `broadband-switch.json` | the base journey — browse packages, then check availability |
| `broadband-switch.postcode-first.json` | the variation — check availability first, then show only what is available |

**In real use a variation is a branch, not a second file** (ADR 0003). Both are checked in here
only so the difference is readable without git, and so the extraction in wave 2 has two
structurally different journeys to induce a single vocabulary from — which is the property that
matters: the port is derived from *all* live variations jointly, not per-variation.

## What the variation is for

The change is one sentence, and it is the sentence you would say out loud in the room:

> Ask for the postcode first, so we only show packages the customer can actually get.

That is the journey conversation this tool exists to hold. The two documents differ in screen
order and in what one screen knows; they use the same components, which is what makes them
comparable down a column.
