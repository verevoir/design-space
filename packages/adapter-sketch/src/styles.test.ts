import { describe, it, expect } from 'vitest';
import { SKETCH_STYLES } from './styles.js';

describe('SKETCH_STYLES', () => {
  it('is a non-empty string', () => {
    expect(typeof SKETCH_STYLES).toBe('string');
    expect(SKETCH_STYLES.length).toBeGreaterThan(0);
  });

  it('declares rules for the prompt component', () => {
    expect(SKETCH_STYLES).toContain('.ds-prompt');
    expect(SKETCH_STYLES).toContain('.ds-prompt__heading');
    expect(SKETCH_STYLES).toContain('.ds-prompt__explain');
  });

  it('declares rules for every action weight', () => {
    expect(SKETCH_STYLES).toContain('.ds-action--primary');
    expect(SKETCH_STYLES).toContain('.ds-action--secondary');
    expect(SKETCH_STYLES).toContain('.ds-action--destructive');
    expect(SKETCH_STYLES).toContain('.ds-action--escape');
  });

  it('reads colour through var(--ds-*) rather than a literal, so a token swap changes it', () => {
    expect(SKETCH_STYLES).toContain('var(--ds-ink');
    expect(SKETCH_STYLES).toContain('var(--ds-paper');
  });

  it('carries no chromatic colour — ink on warm paper only, no accent or destructive hue', () => {
    // Regression guard for the operator's rule, checked against a rendered page: "there must
    // be no colour anywhere in the sketch style ... anything that introduces hue is wrong,
    // regardless of how subtle." These two literals were the blue accent and the red
    // destructive/required colour this file used to read from tokens that no longer exist;
    // their absence here is what stops either from being reintroduced as a literal that
    // bypasses the token layer entirely.
    expect(SKETCH_STYLES).not.toContain('#1a6fb5');
    expect(SKETCH_STYLES).not.toContain('#c0392b');
    expect(SKETCH_STYLES).not.toContain('var(--ds-accent');
    expect(SKETCH_STYLES).not.toContain('var(--ds-destructive');
  });

  it('styles the native checkbox control rather than leaving it to render as an OS default', () => {
    expect(SKETCH_STYLES).toContain('.ds-option__control');
    expect(SKETCH_STYLES).toContain('appearance: none');
  });

  it('reaches render.ts\'s unclassed document shell (body, header h1/p) and its .ds-screen card', () => {
    expect(SKETCH_STYLES).toContain('header h1');
    expect(SKETCH_STYLES).toContain('.ds-screen');
    expect(SKETCH_STYLES).toContain('box-shadow: var(--ds-shadow');
  });

  it('declares rules for the compare-set component, including the emphasis mark', () => {
    expect(SKETCH_STYLES).toContain('.ds-compare-set');
    expect(SKETCH_STYLES).toContain('.ds-compare-set__emphasis-mark');
    expect(SKETCH_STYLES).toContain('.ds-compare-set__item--emphasis');
  });

  it('sizes the rough SVG marks in em units via inline-flex wrappers, not text-sizing rules', () => {
    expect(SKETCH_STYLES).toContain('.ds-status__glyph-svg');
    expect(SKETCH_STYLES).toContain('.ds-compare-set__emphasis-svg');
  });

  it('declares rules for the input-set component', () => {
    expect(SKETCH_STYLES).toContain('.ds-input-set');
    expect(SKETCH_STYLES).toContain('.ds-field__control');
  });

  it('declares rules for both status tones', () => {
    expect(SKETCH_STYLES).toContain('.ds-status--pending');
    expect(SKETCH_STYLES).toContain('.ds-status--good');
  });

  it('declares rules for the option-list component', () => {
    expect(SKETCH_STYLES).toContain('.ds-option-list');
  });

  it('declares rules for the summary component', () => {
    expect(SKETCH_STYLES).toContain('.ds-summary');
    expect(SKETCH_STYLES).toContain('.ds-summary__edit');
  });

  it('has no leading or trailing whitespace', () => {
    expect(SKETCH_STYLES).toBe(SKETCH_STYLES.trim());
  });
});
