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
 */
export const SKETCH_STYLES = `
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
  border-radius: 0;
  box-shadow: var(--ds-shadow, 3px 3px 0 #2b2b2b);
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
  padding: 0.5rem 1.25rem;
  border-radius: var(--ds-radius, 0);
  text-decoration: none;
  font-weight: 600;
  font-family: var(--ds-font-body, sans-serif);
  border: 2px solid var(--ds-ink, #2b2b2b);
  color: var(--ds-ink, #2b2b2b);
  background: transparent;
}
.ds-action--primary {
  border-width: 3px;
  font-weight: 700;
}
.ds-action--secondary {
  border-style: dashed;
  font-weight: 500;
}
.ds-action--destructive {
  border-style: double;
  border-width: 4px;
}
.ds-action--escape {
  border-style: dotted;
  font-family: var(--ds-font-annotation, cursive);
  font-weight: 400;
}
.ds-compare-set {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1.5rem;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
}
.ds-compare-set th,
.ds-compare-set td {
  border: 1.5px solid var(--ds-ink, #111);
  padding: 0.5rem 0.75rem;
  text-align: left;
}
.ds-compare-set__emphasis-mark {
  font-family: var(--ds-font-annotation, cursive);
  font-weight: var(--ds-font-weight-annotation, 600);
  margin-right: 0.35rem;
}
.ds-compare-set__item--emphasis th,
.ds-compare-set__item--emphasis td {
  border-style: dashed;
  border-width: 2px;
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
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1.5px solid var(--ds-ink, #111);
  border-radius: var(--ds-radius, 0);
  margin-bottom: 1rem;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
}
.ds-status--pending { border-style: dashed; }
.ds-status--good { border-style: solid; }
.ds-status__glyph {
  font-size: 1rem;
  font-variant-emoji: text;
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
