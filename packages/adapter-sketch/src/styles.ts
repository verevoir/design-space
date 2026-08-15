/**
 * Sketch adapter component appearance — moved out of `render`'s module
 * constant into the adapter itself (ADR 0008, story 2.2). Every colour and
 * font declaration reads a `var(--ds-*)` custom property with a literal
 * fallback, so a token-variant adapter (4.1) can change appearance by
 * supplying different `tokens`, with no markup and no rule changing.
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
`.trim();
