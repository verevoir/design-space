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
    expect(SKETCH_STYLES).toContain('var(--ds-accent');
    expect(SKETCH_STYLES).toContain('var(--ds-ink');
  });

  it('declares rules for the compare-set component, including the emphasis mark', () => {
    expect(SKETCH_STYLES).toContain('.ds-compare-set');
    expect(SKETCH_STYLES).toContain('.ds-compare-set__emphasis-mark');
    expect(SKETCH_STYLES).toContain('.ds-compare-set__item--emphasis');
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
