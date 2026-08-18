import { describe, it, expect } from 'vitest';
import { SKETCH_CSS_CUSTOM_PROPERTIES } from './tokens.js';

// ---------------------------------------------------------------------------
// SKETCH_CSS_CUSTOM_PROPERTIES — now structured data (ADR 0008), not a CSS
// text block. These tests pin the deliberately-chosen values; changing one
// is a design decision, not a refactor, so the suite must catch it.
// ---------------------------------------------------------------------------

describe('SKETCH_CSS_CUSTOM_PROPERTIES', () => {
  it('is a non-empty record', () => {
    expect(typeof SKETCH_CSS_CUSTOM_PROPERTIES).toBe('object');
    expect(Object.keys(SKETCH_CSS_CUSTOM_PROPERTIES).length).toBeGreaterThan(0);
  });

  it('declares the warm paper background ds-paper as #f0eee9', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-paper']).toBe('#f0eee9');
  });

  it('declares the ink colour ds-ink as #2b2b2b', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-ink']).toBe('#2b2b2b');
  });

  it('declares the accent colour ds-accent as #1a6fb5', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-accent']).toBe('#1a6fb5');
  });

  it('declares ds-font-body with Patrick Hand as the first family', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-font-body']).toContain("'Patrick Hand'");
  });

  it('declares ds-font-annotation with Caveat as the first family', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-font-annotation']).toContain("'Caveat'");
  });

  it('declares ds-font-weight-body as 400', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-font-weight-body']).toBe('400');
  });

  it('declares ds-font-weight-annotation as 600', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-font-weight-annotation']).toBe('600');
  });

  it('declares ds-radius as 6px', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-radius']).toBe('6px');
  });

  it('declares ds-shadow as the hard-offset ink shadow 3px 3px 0', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES['ds-shadow']).toBe('3px 3px 0 #2b2b2b');
  });

  it('every token value is literal — none is a var() composition of another token', () => {
    // A token whose own value references another token defeats a direct
    // lookup (the eventual contrast check, 4.1, reads a value, not a chain).
    for (const [name, value] of Object.entries(SKETCH_CSS_CUSTOM_PROPERTIES)) {
      expect(value, `token "${name}" must be literal, not var(...)`).not.toContain('var(');
    }
  });
});
