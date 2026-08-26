/**
 * Sketch adapter component appearance — moved out of `render`'s module
 * constant into the adapter itself (ADR 0008, story 2.2). Every colour and
 * font declaration reads a `var(--ds-*)` custom property with a literal
 * fallback, so a token-variant adapter (4.1) can change appearance by
 * supplying different `tokens`, with no markup and no rule changing.
 *
 * Story 3.1 added rules for the five components induced in 2.1
 * (`compare-set`, `input-set`, `status`, `option-list`, `summary`). Every
 * one of them stays within the fidelity rule docs/architecture.md §5 sets
 * for this adapter: provisional is carried by typography and colour
 * (handwriting annotation face, dashed vs. solid borders, ink rather than
 * black) — never by a solid highlight fill, a rounded "finished" card, or
 * new geometry. Straight borders throughout, same as the components
 * already here.
 */
export const SKETCH_STYLES = `
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
  border-radius: var(--ds-radius, 4px);
  text-decoration: none;
  font-weight: 600;
  border: 2px solid currentColor;
  color: var(--ds-accent, #1a6fb5);
}
.ds-action--primary {
  background: var(--ds-accent, #1a6fb5);
  color: #fff;
  border-color: var(--ds-accent, #1a6fb5);
}
.ds-action--secondary {
  background: transparent;
  color: var(--ds-accent, #1a6fb5);
}
.ds-action--destructive {
  background: transparent;
  color: var(--ds-destructive, #c0392b);
  border-color: var(--ds-destructive, #c0392b);
}
.ds-action--escape {
  background: transparent;
  color: var(--ds-escape, #555);
  border-color: var(--ds-escape-border, #aaa);
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
  color: var(--ds-destructive, #c0392b);
}
.ds-field__control {
  font-family: var(--ds-font-body, sans-serif);
  font-size: 1rem;
  padding: 0.4rem 0.6rem;
  border: 1.5px solid var(--ds-ink, #111);
  border-radius: var(--ds-radius, 4px);
  background: var(--ds-paper, #f0eee9);
  color: var(--ds-ink, #111);
  width: 100%;
  max-width: 24rem;
}
.ds-status {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1.5px solid var(--ds-ink, #111);
  border-radius: var(--ds-radius, 4px);
  margin-bottom: 1rem;
  font-family: var(--ds-font-body, sans-serif);
  color: var(--ds-ink, #111);
}
.ds-status--pending { border-style: dashed; }
.ds-status--good { border-style: solid; }
.ds-status__glyph { font-size: 1rem; }
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
  color: var(--ds-accent, #1a6fb5);
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
