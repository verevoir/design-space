/**
 * Sketch adapter design tokens, structured (ADR 0008) — name (without the
 * leading `--`) to CSS value. `render` wraps this record in a `:root { }`
 * block and emits it into the document; `sketchAdapter.tokens` is this same
 * record, which is what makes it the sketch design system's token set
 * rather than dead code nothing reads.
 *
 * Every value here is literal, never a `var()` composition — a token is
 * meant to be looked up as a value (by the eventual contrast check, 4.1),
 * and a token whose value is itself a reference to another token defeats
 * that lookup.
 */
export const SKETCH_CSS_CUSTOM_PROPERTIES: Readonly<Record<string, string>> = {
  'ds-paper': '#f0eee9',
  'ds-ink': '#2b2b2b',
  'ds-accent': '#1a6fb5',
  'ds-destructive': '#c0392b',
  'ds-escape': '#555555',
  'ds-escape-border': '#aaaaaa',
  'ds-explain': '#444444',
  'ds-border-color': '#dddddd',
  'ds-gap-border': '#e74c3c',
  'ds-font-body': "'Patrick Hand', 'Comic Sans MS', cursive",
  'ds-font-annotation': "'Caveat', 'Comic Sans MS', cursive",
  'ds-font-weight-body': '400',
  'ds-font-weight-annotation': '600',
  'ds-radius': '6px',
  'ds-shadow': '3px 3px 0 #2b2b2b',
};
