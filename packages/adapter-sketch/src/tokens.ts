/**
 * Sketch adapter design tokens as CSS custom properties.
 *
 * Emitted as a block of CSS so a token-variant adapter can reuse the
 * sketch markup while substituting different values — ADR 0001's degenerate
 * case. Font families are declared here; assets are not fetched from a network
 * at runtime — the browser falls back to the generic stack gracefully.
 *
 * These values declare the provisional character — warm paper background,
 * ink colour, handwriting font families, and a hard-offset shadow — but they
 * are only applied to the page when an adapter or document explicitly includes
 * them. The wave 2S.1 render document uses its own inline styles and does not
 * yet consume these properties.
 */
export const SKETCH_CSS_CUSTOM_PROPERTIES = `
  --ds-paper: #f0eee9;
  --ds-ink: #2b2b2b;
  --ds-accent: #1a6fb5;
  --ds-font-body: 'Patrick Hand', 'Comic Sans MS', cursive;
  --ds-font-annotation: 'Caveat', 'Comic Sans MS', cursive;
  --ds-font-weight-body: 400;
  --ds-font-weight-annotation: 600;
  --ds-border: 1.5px solid var(--ds-ink);
  --ds-radius: 6px;
  --ds-shadow: 3px 3px 0 var(--ds-ink);
`.trim();
