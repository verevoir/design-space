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
  });

  it('removes the hard offset shadow from the screen — outline only, per the operator', () => {
    const rule = SKETCH_STYLES.match(/\.ds-screen\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule![1].replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).toContain('box-shadow: none');
    // Regression guard for the literal offset value the old hard shadow used, so a reintroduced
    // shadow anywhere in the sheet (not just this rule) would be caught.
    expect(SKETCH_STYLES).not.toContain('3px 3px 0');
  });

  it("makes each replaced form control's own border transparent — <input> cannot host a ::before overlay, so the visible rough border is drawn on its wrapper span instead", () => {
    const fieldRule = SKETCH_STYLES.match(/\.ds-field__control\s*\{([^}]*)\}/);
    const optionRule = SKETCH_STYLES.match(/\.ds-option__control\s*\{([^}]*)\}/);
    expect(fieldRule).not.toBeNull();
    expect(optionRule).not.toBeNull();
    expect(fieldRule![1]).toContain('border: 1.5px solid transparent');
    expect(optionRule![1]).toContain('border: 1.5px solid transparent');
  });

  it('carries a visible border colour on each control\'s wrapper, matching what the control itself used to carry', () => {
    const fieldWrapRule = SKETCH_STYLES.match(/\.ds-field__control-wrap::before\s*\{([^}]*)\}/);
    const optionWrapRule = SKETCH_STYLES.match(/\.ds-option__control-wrap::before\s*\{([^}]*)\}/);
    expect(fieldWrapRule).not.toBeNull();
    expect(optionWrapRule).not.toBeNull();
    expect(fieldWrapRule![1]).toContain('var(--ds-ink');
    expect(fieldWrapRule![1]).not.toContain('border: 1.5px solid transparent');
    expect(optionWrapRule![1]).toContain('var(--ds-ink');
    expect(optionWrapRule![1]).not.toContain('border: 1.5px solid transparent');
  });

  it('defines the rough-edge filter once as a custom property, and every roughened border overlay references it (not asserting the encoded filter bytes)', () => {
    expect(SKETCH_STYLES).toContain('--ds-rough-filter:');
    expect(SKETCH_STYLES).toContain('url("data:image/svg+xml,');
    const overlaySelectors = [
      '.ds-screen::before',
      '.ds-action::before',
      '.ds-status::before',
      '.ds-compare-set::before',
      '.ds-field__control-wrap::before',
      '.ds-option__control-wrap::before',
    ];
    for (const selector of overlaySelectors) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rule = SKETCH_STYLES.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
      expect(rule, `expected a ${selector} rule`).not.toBeNull();
      expect(rule![1]).toContain('filter: var(--ds-rough-filter)');
      expect(rule![1]).toContain('pointer-events: none');
    }
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

  it('the emphasised compare-set row is bordered solid, not dashed — emphasis moved off dashed onto weight', () => {
    const rule = SKETCH_STYLES.match(/\.ds-compare-set__item--emphasis[^{]*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    // Strip comments before asserting: the rule is preceded by an explanatory comment that
    // itself says the word "dashed" (naming what this moved off), which a plain substring
    // check would wrongly trip. The declarations are what must not say it.
    const body = rule![1].replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).toContain('border: 3px solid currentColor');
    expect(body).not.toContain('dashed');
  });

  it('sizes the pending status glyph differently from the default (good) glyph, since the two no longer share a viewBox', () => {
    // Both tones render the identical .ds-status__glyph-svg class (adapter.ts's roughGlyph does
    // not vary the class by tone), so distinct sizing can only come from a rule scoped through
    // the ancestor .ds-status--pending wrapper — not from the class alone.
    const defaultRule = SKETCH_STYLES.match(/(?<!--pending )\.ds-status__glyph-svg\s*\{([^}]*)\}/);
    const pendingRule = SKETCH_STYLES.match(/\.ds-status--pending \.ds-status__glyph-svg\s*\{([^}]*)\}/);
    expect(defaultRule).not.toBeNull();
    expect(pendingRule).not.toBeNull();
    expect(pendingRule![1]).not.toBe(defaultRule![1]);
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
