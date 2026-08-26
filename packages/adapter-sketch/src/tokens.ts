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
 *
 * Every value below is achromatic (grey/ink/paper, R=G=B) except
 * 'ds-gap-border', with one exception explained in its own entry — the
 * operator's rule for this adapter is "no colour anywhere in the sketch
 * style; ink on warm paper only." 'ds-accent', 'ds-destructive', 'ds-escape'
 * and 'ds-escape-border' — a blue, a red, and two greys that became unused
 * once styles.ts stopped reading them for colour — were removed rather than
 * kept as dead or misleading data. 'ds-radius' is '0': §5 requires straight
 * borders throughout, and this token drives every rounded corner styles.ts
 * still reads it from.
 */
export const SKETCH_CSS_CUSTOM_PROPERTIES: Readonly<Record<string, string>> = {
  'ds-paper': '#f0eee9',
  'ds-ink': '#2b2b2b',
  'ds-explain': '#444444',
  'ds-border-color': '#dddddd',
  // Colours only render.ts's own GAP placeholder (a build-time diagnostic overlay this
  // design system does not otherwise use) — see the commit message for why this one
  // token is not achromatic like every other value here.
  'ds-gap-border': '#e74c3c',
  'ds-font-body': "'Patrick Hand', 'Comic Sans MS', cursive",
  'ds-font-annotation': "'Caveat', 'Comic Sans MS', cursive",
  'ds-font-weight-body': '400',
  'ds-font-weight-annotation': '600',
  'ds-radius': '0',
};
