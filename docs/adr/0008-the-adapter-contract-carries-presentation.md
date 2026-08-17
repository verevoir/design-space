# ADR 0008 — The adapter contract carries presentation, in a package of its own

**Status:** accepted, 2026-08-15

## Context

ADR 0001's central claim is that an adapter decides what a component *looks like*. As built, it
cannot.

- `render.ts` owns the `<style>` block through a module-private `PAGE_CSS` constant, and that
  constant carries not only a document reset but **component appearance** — `.ds-prompt*`,
  `.ds-action--*`. Every adapter therefore renders identically.
- The contract is `{ name, components }`. It is declared in
  `packages/adapter-sketch/src/adapter.ts` — in the reference adapter, not in a shared seam — and
  has no way to contribute CSS at all.
- `SKETCH_CSS_CUSTOM_PROPERTIES` (`packages/adapter-sketch/src/tokens.ts`) is a block of bare
  `--ds-*` declarations with no selector wrapper. Nothing outside its own test reads it. The
  served page contains no `--ds-*` properties.
- `render` and `gate` each hold their own `AdapterLike` interface
  (`packages/render/src/render.ts`, `packages/gate/src/adapter-like.ts`). These are **structural
  copies**, not imports of anything.

Story 3.1 cannot give the sketch adapter a sketch style until this is fixed, and 4.1 — token
variants over shared markup — is unbuildable, because swapping a token set today changes nothing
on screen.

## Decision

The adapter contract carries presentation, as **two fields alongside `name` and `components`**:

- **`styles`** — a CSS rules string, written against `var(--ds-*)`, describing that adapter's
  component appearance.
- **`tokens`** — the token set as **structured data**, a record of token name to value; not an
  opaque string.

The contract type moves out of `adapter-sketch` into a **new package of its own**. `render`,
`gate` and `adapter-sketch` all import it, and both structural `AdapterLike` copies are deleted.

It lands as a **precursor story before 3.1** (backlog 2.2), not inside it.

### Two reasons, and they matter more than the shape

1. **The contrast check forces structure.** Story 4.1's done-bar requires that *the contrast check
   passes for each* variant, and §7 lists contrast among the countable checks. An opaque CSS
   string cannot be contrast-checked — a gate would have to parse CSS to find out what a colour
   is. Structured `tokens` is what makes the check a lookup rather than a parse. This is why
   `tokens` is data and `styles` is not.

2. **Widening alone would be a no-op that reads like a fix.** Because `render`'s and `gate`'s
   `AdapterLike` are *structural* copies rather than imports, adding fields to the contract breaks
   neither of them: both keep compiling and both silently ignore the new fields, so the page would
   still carry no `--ds-*` properties and the change would look done. **Any widening that does not
   delete both duplicates and point them at the shared contract has changed nothing.** That
   deletion is part of the decision, not an incidental tidy-up.

### Why not `port`

ADR 0004 wants a shared seam, and `port` is the obvious existing one — every wave 3 story already
reads it. It was rejected because `port`'s own header states that **nothing in that package may
know about rendering or any specific adapter**, and `styles` is CSS: it is rendering. Putting the
contract there would either falsify that header or require relaxing it, and `port` is the contract
whose stability is the reason wave 3 fans at all.

A new package keeps `port` ignorant while still giving one shared seam, and it passes ADR 0004's
test: it could be published and consumed from another repository without moving code — which is
exactly what happens when an external design system owns its own adapter in phase 3.

## Alternatives rejected

- **A single `styles` string, with token values inlined into it.** Rejected: every token variant
  would have to duplicate the whole ruleset to change a colour, which is the opposite of ADR
  0001's degenerate-adapter case being cheap; and the contrast check would have nothing
  structured to read.
- **A `presentation: { rules, tokens }` sub-object.** Rejected: identical mechanics with more
  ceremony, for a nesting that buys nothing today. It remains reachable from this shape if a
  non-CSS render target ever appears.
- **The adapter emitting its own `<head>` or whole document.** Rejected on two counts: it destroys
  4.1's enforceable "switching between variants changes no markup", since the markup would then be
  the adapter's to vary; and a document-emitting adapter wants to reference files, which is the
  door ADR 0002 closes by making everything `(object, ref)` through one resolver.

## Consequences

- `render` stops owning component appearance. `PAGE_CSS` keeps the document reset only; the
  `.ds-*` component rules move to the sketch adapter's `styles`.
- `render` gains the job of emitting the adapter's tokens as a **wrapped declaration block** — the
  token set is bare declarations with no selector — scoped so that two documents from different
  adapters on one page do not affect each other's styling, which 3.2's done-bar already requires.
- `gate` can read a token value as data: resolution and contrast become checks rather than
  aspirations (3.3), and 4.1's contrast bar becomes satisfiable.
- Every adapter must now supply `styles` and `tokens`, including the stub adapters in `render`'s
  and `gate`'s tests. That cost is paid once, in 2.2.
- One more package and one more dependency edge, against three packages that stop guessing at the
  same shape.
- `SKETCH_CSS_CUSTOM_PROPERTIES` stops being dead code, and the served page carries `--ds-*`
  properties — which is the observable proof the change landed.

## Trigger to revisit

A render target that is not CSS — native, PDF, email — or the first adapter that cannot express
its appearance as rules against `var(--ds-*)`. Either would mean `styles` is the wrong name for
the field, and `presentation: { rules, tokens }`, rejected above for ceremony, is where to go.

Also worth revisiting if a third presentation field is proposed: two fields is a contract, four is
a package boundary in the wrong place.
