# ADR 0010 — Border roughness: three mechanisms prototyped live, one implemented, one blocked

**Status:** accepted, 2026-08-27 — records findings from prototyping done directly against the
running studio, in the browser, not reasoned about in the abstract. The decision below is narrow
and already true today: the shipped mechanism does not change. The harder question this ADR
surfaces — whether to implement the mechanism that actually worked best — is stated, not decided,
in "Trigger to revisit".

## Context

`docs/architecture.md` §5 and `packages/adapter-sketch/src/styles.ts` describe and implement the
sketch adapter's hand-drawn border treatment as a percent-encoded `data:image/svg+xml`
`feTurbulence` / `feDisplacementMap` CSS filter — declared once as the `--ds-rough-filter` custom
property and applied via `filter: var(--ds-rough-filter)` on a `::before` layer over
`.ds-screen`, `.ds-action`, `.ds-status` and the compare-set `<table>`. That is one of three
mechanisms that were prototyped
live today before that one was chosen. The other two are recorded here so the reasoning survives
a restart rather than being re-derived — or re-attempted — later.

All three share the same starting constraint: the adapter supplies a stylesheet and, for the
components it renders itself, markup — never a document-wide script (no JavaScript; the document
is static and prerendered) and never knowledge of an element's actual rendered size (layout
happens in the browser, after the adapter's work is done).

## Decision

**Keep the CSS turbulence filter as implemented in `packages/adapter-sketch/src/styles.ts`'s
`--ds-rough-filter` custom property.** No change to shipped behaviour.

Its virtue is that it is **size-independent** — a CSS `filter` displaces whatever geometry is
already drawn, so the same declaration works correctly on a narrow button and a wide screen
card without knowing either width in advance. Its limit, also confirmed by eye: it displaces a
**single straight line**, so the result reads as a *wobbly* line rather than a *drawn* one.
Excalidraw's actual character comes from **two overlapping, slightly-divergent passes** over the
same edge — an effect a single-pass filter on a single border cannot produce, because there is
only one line for it to displace.

## Alternatives prototyped

### Approach 2 — one SVG per element, stretched (`preserveAspectRatio="none"`)

Drawing two overlapping hand-jittered passes directly as SVG paths, then stretching that one SVG
to fill the element with `preserveAspectRatio="none"`, gave genuinely better character — visibly
"gone round twice", the thing the filter approach couldn't produce.

**It fails on wide elements.** `vector-effect="non-scaling-stroke"` correctly keeps the *stroke
width* constant under a non-uniform stretch, but it does nothing for the *jitter geometry itself*
— the path's own coordinates still scale non-uniformly with the element. On a 570px-wide screen
card, the two passes' corners visibly diverged from each other; on a button-sized element the same
SVG looked correct, because the stretch was closer to uniform there.

The cause is **structural, not a tuning problem**: fixing it would require knowing the element's
rendered aspect ratio to counter-scale the jitter, and the adapter has no way to know that. The
document is static and prerendered with no JavaScript — there is no point at which the adapter's
output and the browser's layout pass ever meet.

### Approach 3 — four SVGs per element, one per edge, two passes each

**This is the one that worked** — size-independent *and* genuinely drawn-looking, because it
sidesteps approach 2's flaw rather than tuning around it. Each of an element's four edges gets its
own SVG, stretched along **one axis only** — the axis it needs to span the element's actual
width or height — while the jitter, which runs *perpendicular* to that axis, is never distorted,
because perpendicular is exactly the direction that single-axis stretch doesn't touch.

Shape, for whoever builds this:

- Horizontal edges (top, bottom): wobble encoded in **Y**, viewBox like `0 0 100 6`, stretched
 along X to the element's width.
- Vertical edges (left, right): wobble encoded in **X**, viewBox `0 0 6 100`, stretched along Y
 to the element's height.
- `vector-effect="non-scaling-stroke"` on every path, so stroke width stays constant regardless
 of the per-axis stretch.
- **Two paths per edge**, at slightly different jitter offsets — this is what supplies the
 "gone round twice" character approach 1 cannot produce, without approach 2's distortion.

### The approach that did not work — CSS `border-image` with an SVG data URI

Attractive on paper: no markup at all, applies purely from CSS, and `border-image-repeat: repeat`
tiles a slice rather than stretching it — which looked like it would sidestep approach 2's
distortion for free.

**It does not work, and the reason is inherent to the mechanism, not a parameter to tune.**
`border-image` slices a fixed band from the source image and **tiles** that slice along the edge.
Any jitter drawn into the sliced band repeats at the tile's own period, so the border reads as a
visibly *periodic* pattern — a repeating motif — rather than as one continuous hand-drawn line.
There is no tiling mode that produces non-repeating variation along a `border-image` edge; a
single wobble in the source tile is a single wobble that recurs, by construction. Recorded so
nobody spends an afternoon rediscovering this.

## Why approach 3 is not implemented

`.ds-screen` and `.ds-action` are markup `render.ts` emits, not the adapter's — see ADR 0008: the
adapter contract carries a stylesheet and, separately, **per-component renderers for the
components it owns**. Approach 3 needs four (or more) child `<svg>` elements inside the bordered
element, which the adapter has no way to inject into markup it does not render.

`.ds-status`, the compare-set `<table>`, and the `input-set`/`option-list` control wrappers **are**
adapter-owned markup already (the wrapper-span pattern used for the rough `::before` treatment on
form controls is exactly this kind of adapter-supplied structure) — approach 3 could be applied to
those today, inside the existing contract, with no decision required.

`.ds-screen` and `.ds-action` cannot take it without one of:

1. extending the adapter contract so an adapter can contribute markup around `render.ts`-owned
 elements, not only its own components;
2. having `render.ts` itself emit a fixed structural hook (e.g. four edge `<span>`s) that any
 adapter's CSS may or may not use, whether or not that adapter wants roughened edges at all; or
3. accepting a **mixed treatment** — adapter-owned elements get approach 3, `render.ts`-owned
 elements keep approach 1 — as a permanent, not merely transitional, state.

**This ADR does not choose between them.** It states the blocker so the choice is made
deliberately, by whoever picks it up, rather than being made by default because nobody wrote it
down.

## Consequences

- No code change. `packages/adapter-sketch/src/styles.ts`'s `--ds-rough-filter` filter stands;
 `docs/architecture.md` §5 continues to describe what is actually implemented and is not
 amended by this ADR.
- The next attempt at richer border character has three prior findings to start from instead of
 zero: two dead ends with reasons, and one working mechanism with a stated precondition.

## Trigger to revisit

Either: a `.ds-screen`/`.ds-action` visual bar that approach 1's single-pass wobble cannot meet —
at which point the three options above are the actual decision to make — or a second adapter
whose own component markup would also benefit from approach 3, which would argue for resolving
the contract question once rather than per-adapter.
