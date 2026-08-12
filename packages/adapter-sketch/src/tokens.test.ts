import { describe, it, expect } from 'vitest';
import { SKETCH_CSS_CUSTOM_PROPERTIES } from './tokens.js';

// ---------------------------------------------------------------------------
// SKETCH_CSS_CUSTOM_PROPERTIES
//
// These tests pin the deliberately-chosen values documented in tokens.ts.
// The properties declare the provisional sketch character (warm paper, ink
// colour, handwriting fonts, hard-offset shadow); changing a value is a
// deliberate design decision, not a refactor, so the suite must catch it.
// ---------------------------------------------------------------------------

describe('SKETCH_CSS_CUSTOM_PROPERTIES', () => {
  it('is a non-empty string', () => {
    expect(typeof SKETCH_CSS_CUSTOM_PROPERTIES).toBe('string');
    expect(SKETCH_CSS_CUSTOM_PROPERTIES.length).toBeGreaterThan(0);
  });

  it('declares the warm paper background --ds-paper as #f0eee9', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-paper: #f0eee9');
  });

  it('declares the ink colour --ds-ink as #2b2b2b', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-ink: #2b2b2b');
  });

  it('declares the accent colour --ds-accent as #1a6fb5', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-accent: #1a6fb5');
  });

  it('declares --ds-font-body with Patrick Hand as the first family', () => {
    // Patrick Hand is the intentional choice; the rest of the stack is fallback.
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain("--ds-font-body: 'Patrick Hand'");
  });

  it('declares --ds-font-annotation with Caveat as the first family', () => {
    // Caveat is the intentional choice; the rest of the stack is fallback.
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain("--ds-font-annotation: 'Caveat'");
  });

  it('declares --ds-font-weight-body as 400', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-font-weight-body: 400');
  });

  it('declares --ds-font-weight-annotation as 600', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-font-weight-annotation: 600');
  });

  it('declares --ds-border as 1.5px solid referencing --ds-ink', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-border: 1.5px solid var(--ds-ink)');
  });

  it('declares --ds-radius as 6px', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-radius: 6px');
  });

  it('declares --ds-shadow as the hard-offset ink shadow 3px 3px 0', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toContain('--ds-shadow: 3px 3px 0 var(--ds-ink)');
  });

  it('has no leading or trailing whitespace (trim() was applied)', () => {
    // trim() is called in the source so the string is safe to embed in a <style> block
    // without extra blank lines at the boundaries.
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toBe(SKETCH_CSS_CUSTOM_PROPERTIES.trim());
  });
});
