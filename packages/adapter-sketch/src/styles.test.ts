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

  it('has no leading or trailing whitespace', () => {
    expect(SKETCH_STYLES).toBe(SKETCH_STYLES.trim());
  });
});
