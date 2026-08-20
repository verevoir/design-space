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

  // A single whole-object assertion, deliberately, rather than one
  // assertion per token: per-token assertions (the previous shape of this
  // block) only catch a change to a token already named in a test — they
  // say nothing about a token added to the record with no matching
  // assertion, which is exactly how six of fifteen values shipped unpinned
  // in the PR this test now closes. Asserting the whole record against a
  // literal expected object means an addition, a removal, or an edited
  // value all fail this one test, not just a value's own dedicated line.
  //
  // This is deliberately brittle: any deliberate token change requires
  // editing the expected object below too. That is the point, not a
  // drawback — the header comment above says a token change is "a design
  // decision, not a refactor," so the suite is meant to notice every one.
  // Do not loosen this back to per-key assertions or a subset check; that
  // reopens the exact hole it exists to close.
  it('pins every current token to its exact value, so no value can change or be added without a test noticing', () => {
    expect(SKETCH_CSS_CUSTOM_PROPERTIES).toEqual({
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
    });
  });

  it('every token value is literal — none is a var() composition of another token', () => {
    // A token whose own value references another token defeats a direct
    // lookup (the eventual contrast check, 4.1, reads a value, not a chain).
    for (const [name, value] of Object.entries(SKETCH_CSS_CUSTOM_PROPERTIES)) {
      expect(value, `token "${name}" must be literal, not var(...)`).not.toContain('var(');
    }
  });
});
