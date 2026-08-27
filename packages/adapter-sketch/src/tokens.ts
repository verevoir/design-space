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
 * kept as dead or misleading data. 'ds-radius' is '0' — styles.ts reads this
 * token for every corner it draws (`.ds-action`, `.ds-field__control`,
 * `.ds-status`), so setting it here squares them all without editing each
 * rule individually. (Not restated from §5 here on purpose: §5 has already
 * moved twice since this file was written, most recently to make rough
 * geometry a carrier of provisional-ness rather than an absence of it — see
 * AGENTS.md's own note about a summary drifting out of sync with §5 once.
 * This comment states only what is true of this file and checkable against
 * it, so it cannot drift the same way again.)
 */
export const SKETCH_CSS_CUSTOM_PROPERTIES: Readonly<Record<string, string>> = {
  'ds-paper': '#f0eee9',
  'ds-ink': '#2b2b2b',
  'ds-explain': '#444444',
  'ds-border-color': '#dddddd',
  // render.ts's .ds-gap rule is a build-time diagnostic overlay — a visible box naming a
  // component with no renderer, seen by a developer during development, never part of the
  // finished sketch output — so it sits outside the achromatic rule above and keeps a real
  // colour to stay legible as "something is wrong here" at a glance.
  'ds-gap-border': '#e74c3c',
  'ds-font-body': "'Patrick Hand', 'Comic Sans MS', cursive",
  'ds-font-annotation': "'Caveat', 'Comic Sans MS', cursive",
  'ds-font-weight-body': '400',
  'ds-font-weight-annotation': '600',
  'ds-radius': '0',
};
