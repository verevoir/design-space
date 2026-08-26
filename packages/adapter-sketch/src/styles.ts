/**
 * Sketch adapter component appearance — moved out of `render`'s module
 * constant into the adapter itself (ADR 0008, story 2.2). Every colour and
 * font declaration reads a `var(--ds-*)` custom property with a literal
 * fallback, so a token-variant adapter (4.1) can change appearance by
 * supplying different `tokens`, with no markup and no rule changing.
 *
 * Story 3.1 added rules for the five components induced in 2.1
 * (`compare-set`, `input-set`, `status`, `option-list`, `summary`).
 *
 * Corrected the same day, against a real rendered page rather than a
 * source read: §5 requires provisional to be carried by typography and
 * BORDER STYLE — never colour, never new geometry (a rounded corner is
 * exactly that) — and several rules here still painted real hue (a blue
 * accent, a red destructive/required marker) or rounded corners. Every
 * rule below now reads only `--ds-ink` / `--ds-paper` / `--ds-explain` for
 * colour (all achromatic), and distinguishes action weight by border style
 * instead: dashed for de-emphasis (the same meaning dashed already carries
 * for `.ds-status--pending` and compare-set emphasis), double for a
 * destructive action, dotted for the lowest-emphasis escape action.
 * `--ds-radius` moved to `0` in tokens.ts, which straightens every rule
 * below that reads it without editing each one individually.
 *
 * A short "document shell" section up top overrides `body`, `header h1` /
 * `header p`, and `.ds-screen` — elements `render.ts` emits unclassed or
 * with a document-owned class. `render.ts` was not changed to add classes
 * for this: `body`/`header`/`h1`/`p` are each structurally singular in the
 * document (exactly one of each), so a plain element selector reaches them
 * from CSS alone, and `.ds-screen` is already a class this adapter can
 * safely re-target — CSS rules of equal specificity resolve in source
 * order, and this stylesheet is emitted after `render.ts`'s own document
 * CSS (see `buildDocument` in render.ts), so these rules win.
 *
 * Same-day follow-up: `.ds-status__glyph` and `.ds-compare-set__emphasis-mark` moved from
 * text-sizing rules to inline-flex wrappers around an SVG mark (see adapter.ts's `roughGlyph`)
 * — the borrowed characters carried a designed voice, the opposite of the placeholder a glyph
 * is meant to read as here. The two `*-svg` selectors size the mark in `em`; colour is
 * untouched, since the mark inherits `currentColor` from its ink-coloured wrapper already.
 *
 * Same-day follow-up: hard offset shadows replaced by a hand-drawn (Excalidraw-style) outline,
 * per the operator. The adapter has no markup hook to add a wrapping element for roughening —
 * it supplies CSS and tokens only — so the wobble is an SVG filter (feTurbulence +
 * feDisplacementMap) declared as a `data:image/svg+xml` URL and referenced from `filter:`,
 * verified live in Chrome against the running studio: no external asset, no new dependency,
 * entirely inside the adapter's existing CSS-and-tokens contract. Declared once as
 * `--ds-rough-filter` below and reused everywhere a rough edge is needed. Verified in Chrome
 * only — data-URI SVG filter support has historically varied across browsers, and that has not
 * been checked here.
 *
 * The filter is applied to a `::before` overlay, never to the element itself: filtering the
 * element displaces its text along with its border, and wobbly body text reads as a rendering
 * fault, not as hand-drawn (seen directly in the browser). So `.ds-screen`, `.ds-action`,
 * `.ds-status` and the compare-set `<table>` keep a real but transparent border (for box
 * sizing only), gain `position: relative`, and grow a `::before` that is absolutely positioned
 * over the same edge, carries the visible filtered border, and is `pointer-events: none` so it
 * cannot intercept clicks. Each element's existing border vocabulary — primary heavier,
 * secondary dashed, destructive double, escape dotted, `ds-status--pending` dashed — is
 * preserved unchanged on the host rule (still reserving the right box size, now invisible) and
 * mirrored onto its `::before`; only which layer draws it moves.
 *
 * `.ds-field__control` and `.ds-option__control` are deliberately excluded from all of this:
 * both are replaced elements (`<input>`), and a replaced element cannot render
 * `::before`/`::after` content at all — probed directly (`content` comes back empty) rather
 * than assumed. They keep their real, straight-edged borders below; this is a browser
 * constraint, not an oversight.
 */
export const SKETCH_STYLES = `
:root {
  /* feTurbulence + feDisplacementMap: a fixed, small displacement so a straight edge reads as
   * drawn rather than as a rendering glitch. Percent-encoded per Chrome's own requirement for
   * a data:image/svg+xml URL referenced with a #fragment from CSS — unencoded angle brackets
   * and quotes are not accepted there. */
  --ds-rough-filter: url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter%20id=%22r%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%220.02%22%20numOctaves=%223%22%20seed=%227%22%20result=%22n%22/%3E%3CfeDisplacementMap%20in=%22SourceGraphic%22%20in2=%22n%22%20scale=%223%22/%3E%3C/filter%3E%3C/svg%3E#r");
}
body {
  background: var(--ds-paper, #f0eee9);
  color: var(--ds-ink, #2b2b2b);
  font-family: var(--ds-font-body, 'Patrick Hand', 'Comic Sans MS', cursive);
}
header h1,
header p {
  font-family: var(--ds-font-body, 'Patrick Hand', 'Comic Sans MS', cursive);
  font-weight: var(--ds-font-weight-body, 400);
  color: var(--ds-ink, #2b2b2b);
}
.ds-screen {
  /* Hard offset shadow removed per operator: outline only, no drop shadow. */
  position: relative;
  border-radius: 0;
  border-color: transparent; /* real border kept for box sizing; the visible edge is drawn by ::before */
  box-shadow: none;
}
.ds-screen::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid var(--ds-ink, #2b2b2b);
  filter: var(--ds-rough-filter);
  pointer-events: none;
}
.ds-prompt { margin-bottom: 1.5rem; }
.ds-prompt__heading {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  font-family: var(--ds-font-body, sans-serif);
  font-weight: var(--ds-font-weight-body, 400);
  color: var(--ds-ink, #111);
}
.ds-prompt__explain {
  margin: 0;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-explain, #444);
}
.ds-action {
  display: inline-block;
  position: relative;
  padding: 0.5rem 1.25rem;
  border-radius: var(--ds-radius, 0);
  text-decoration: none;
  font-weight: 600;
  font-family: var(--ds-font-body, sans-serif);
  border: 2px solid transparent; /* real border kept for box sizing; the visible edge is drawn by ::before */
  color: var(--ds-ink, #2b2b2b);
  background: transparent;
}
.ds-action::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 2px solid var(--ds-ink, #2b2b2b);
  filter: var(--ds-rough-filter);
  pointer-events: none;
}
.ds-action--primary {
  border-width: 3px;
  font-weight: 700;
}
.ds-action--primary::before {
  border-width: 3px;
}
.ds-action--secondary {
  border-style: dashed;
  font-weight: 500;
}
.ds-action--secondary::before {
  border-style: dashed;
}
.ds-action--destructive {
  border-style: double;
  border-width: 4px;
}
.ds-action--destructive::before {
  border-style: double;
  border-width: 4px;
}
.ds-action--escape {
  border-style: dotted;
  font-family: var(--ds-font-annotation, cursive);
  font-weight: 400;
}
.ds-action--escape::before {
  border-style: dotted;
}
.ds-compare-set {
  position: relative;
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1.5rem;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
}
.ds-compare-set::before {
  /* Roughens the table's own outer edge only — cell borders (th/td, border-collapse) stay
   * straight and untouched below, so the internal grid still reads as a real table. */
  content: "";
  position: absolute;
  inset: 0;
  border: 1.5px solid var(--ds-ink, #111);
  filter: var(--ds-rough-filter);
  pointer-events: none;
}
.ds-compare-set th,
.ds-compare-set td {
  border: 1.5px solid var(--ds-ink, #111);
  padding: 0.5rem 0.75rem;
  text-align: left;
}
.ds-compare-set__emphasis-mark {
  display: inline-flex;
  align-items: center;
  margin-right: 0.35rem;
}
.ds-compare-set__emphasis-svg {
  /* Verified live in the browser: the irregular four-stroke path is invisible below this size. */
  width: 1.5em;
  height: 1.5em;
}
.ds-compare-set__item--emphasis th,
.ds-compare-set__item--emphasis td {
  /* Moved off dashed onto weight: dashed is overloaded elsewhere in this stylesheet
   * (ds-action--secondary, ds-status--pending, ds-summary__row), and a heavy solid row
   * reads as "this one" immediately rather than adding a fourth meaning to the same style. */
  border: 3px solid currentColor;
}
.ds-input-set { margin-bottom: 1.5rem; }
.ds-field { margin-bottom: 1rem; }
.ds-field:last-child { margin-bottom: 0; }
.ds-field__label {
  display: block;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
  margin-bottom: 0.25rem;
}
.ds-field__required {
  font-family: var(--ds-font-annotation, cursive);
  color: var(--ds-ink, #2b2b2b);
}
.ds-field__control {
  /* Not roughened: <input> is a replaced element and cannot render ::before/::after content
   * (probed directly — "content" comes back empty). This is a browser constraint, not an
   * oversight — the real, straight-edged border below stays, or the field silently loses its
   * border entirely, which is what happened on the first attempt at this. */
  font-family: var(--ds-font-body, sans-serif);
  font-size: 1rem;
  padding: 0.4rem 0.6rem;
  border: 1.5px solid var(--ds-ink, #111);
  border-radius: var(--ds-radius, 0);
  background: var(--ds-paper, #f0eee9);
  color: var(--ds-ink, #111);
  width: 100%;
  max-width: 24rem;
  appearance: none;
  -webkit-appearance: none;
  box-shadow: none;
}
.ds-status {
  display: flex;
  position: relative;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1.5px solid transparent; /* real border kept for box sizing; the visible edge is drawn by ::before */
  border-radius: var(--ds-radius, 0);
  margin-bottom: 1rem;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
}
.ds-status::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 1.5px solid var(--ds-ink, #111);
  filter: var(--ds-rough-filter);
  pointer-events: none;
}
.ds-status--pending { border-style: dashed; }
.ds-status--pending::before { border-style: dashed; }
.ds-status--good { border-style: solid; }
.ds-status--good::before { border-style: solid; }
.ds-status__glyph {
  display: inline-flex;
  align-items: center;
}
.ds-status__glyph-svg {
  width: 1.1em;
  height: 1.1em;
}
/*
 * The pending and good glyphs no longer share a viewBox (pending is 14×20 wide vs
 * good's 20×20 square, so the hourglass reads narrow rather than square-bowtie), but both
 * SVGs carry the identical .ds-status__glyph-svg class — roughGlyph() does not vary the
 * class by tone. The only hook that distinguishes them is the ancestor .ds-status--pending
 * wrapper, so the tone-specific size is reached as a descendant selector from there, kept
 * more specific than the rule above so it wins regardless of source order.
 */
.ds-status--pending .ds-status__glyph-svg {
  width: 1.25em;
  height: 1.8em;
  vertical-align: -0.35em;
}
.ds-status__label {
  font-family: var(--ds-font-annotation, cursive);
  font-weight: var(--ds-font-weight-annotation, 600);
  text-transform: uppercase;
  font-size: 0.8rem;
}
.ds-option-list {
  margin-bottom: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.ds-option {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
}
.ds-option__control {
  /* Not roughened: same replaced-element constraint as .ds-field__control above — <input>
   * cannot render ::before/::after content, so this keeps its real, straight-edged border. */
  appearance: none;
  -webkit-appearance: none;
  width: 1.1rem;
  height: 1.1rem;
  flex-shrink: 0;
  margin-top: 0.2rem;
  border: 1.5px solid var(--ds-ink, #2b2b2b);
  border-radius: 0;
  background: var(--ds-paper, #f0eee9);
  position: relative;
}
.ds-option__control:checked::after {
  content: "✓";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  line-height: 1;
  color: var(--ds-ink, #2b2b2b);
}
.ds-option__label { font-weight: 600; }
.ds-option__detail {
  display: block;
  font-family: var(--ds-font-annotation, cursive);
  color: var(--ds-explain, #444);
}
.ds-summary { margin-bottom: 1.5rem; }
.ds-summary__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1.5px dashed var(--ds-border-color, #ddd);
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
}
.ds-summary__row:last-child { border-bottom: none; }
.ds-summary__label { font-weight: 600; }
.ds-summary__value { flex: 1; }
.ds-summary__edit {
  font-family: var(--ds-font-annotation, cursive);
  color: var(--ds-ink, #2b2b2b);
  text-decoration: underline dashed;
}
.ds-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`.trim();
