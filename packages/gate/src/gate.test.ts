import { describe, it, expect } from 'vitest';
import { check, WCAG21_AA_NORMAL_TEXT_CONTRAST } from './gate.js';
import { render } from '@design-space/render';
import type { JourneyDocument } from '@design-space/journey-model';
import type { AdapterLike } from '@design-space/adapter-contract';
import { PORT_COMPONENTS, type ComponentName } from '@design-space/port';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_JOURNEY: JourneyDocument = {
  id: 'gate-test',
  title: 'Gate test journey',
  intent: 'Coverage check fixture.',
  entry: 'screen-1',
  screens: [
    {
      id: 'screen-1',
      purpose: 'First screen.',
      blocks: [
        { component: 'prompt', props: { heading: 'Hello' } },
        { component: 'compare-set', props: {} },
      ],
      actions: [],
      annotations: [],
    },
    {
      id: 'screen-2',
      purpose: 'Second screen.',
      blocks: [
        { component: 'input-set', props: {} },
      ],
      actions: [],
      annotations: [],
    },
  ],
};

/**
 * Adapter that implements only `prompt`. Wave 2S.1's port had exactly one
 * component, so this adapter was complete against it; story 2.1 widened the
 * port to six, so this adapter is now deliberately partial — used below to
 * exercise both the 'implemented' and 'missing' halves of check().
 */
const SKETCH_LIKE_ADAPTER: AdapterLike = {
  name: 'sketch',
  components: {
    prompt: (_props) => `<div class="ds-prompt">Prompt</div>`,
  },
  styles: '',
  tokens: {},
};

/** Adapter that implements nothing. */
const EMPTY_ADAPTER: AdapterLike = {
  name: 'empty',
  components: {},
  styles: '',
  tokens: {},
};

/** Adapter where prompt exists but always throws — simulates a renderer defect. */
const THROWING_ADAPTER: AdapterLike = {
  name: 'throwing',
  components: {
    prompt: (_props) => { throw new Error('renderer exploded'); },
  },
  styles: '',
  tokens: {},
};

/**
 * A journey where the prompt block has props that are invalid against the port
 * schema (heading is required but absent). render() will set schemaError on the
 * gap record; gate must classify this as kind='schema', not 'gap' or 'defect'.
 */
const SCHEMA_INVALID_JOURNEY: JourneyDocument = {
  id: 'gate-schema-test',
  title: 'Schema invalid journey',
  intent: 'Forces a schema-validation gap.',
  entry: 'screen-1',
  screens: [
    {
      id: 'screen-1',
      purpose: 'Schema invalid screen.',
      blocks: [
        // heading is required by the prompt port schema; omitting it causes a
        // schema-validation failure in render() — schemaError is set on the gap.
        { component: 'prompt', props: {} },
      ],
      actions: [],
      annotations: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests — gaps come from a real render() call, not a hand-made fixture
// ---------------------------------------------------------------------------

describe('check()', () => {
  describe('implemented components', () => {
    it('lists prompt as implemented when the adapter has a prompt renderer', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      expect(report.implemented).toContain('prompt');
    });

    it('implemented list is empty when the adapter has no components', () => {
      const { gaps } = render(MINIMAL_JOURNEY, EMPTY_ADAPTER);
      const report = check(EMPTY_ADAPTER, gaps);
      expect(report.implemented).toHaveLength(0);
    });
  });

  describe('missing components', () => {
    it('lists every registered port component the adapter does not implement as missing (prompt-only adapter, six-component port)', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      // Derived from the registry, not hardcoded — stays true as 3.1 adds
      // renderers and as later components are registered, rather than
      // needing another edit here each time either changes.
      const expectedMissing = (Object.keys(PORT_COMPONENTS) as ComponentName[]).filter(
        (name) => !Object.prototype.hasOwnProperty.call(SKETCH_LIKE_ADAPTER.components, name),
      );
      expect(expectedMissing).toEqual(
        expect.arrayContaining(['compare-set', 'input-set', 'status', 'option-list', 'summary']),
      );
      expect(report.missing.slice().sort()).toEqual(expectedMissing.slice().sort());
    });

    it('lists prompt as missing when the adapter has no components', () => {
      const { gaps } = render(MINIMAL_JOURNEY, EMPTY_ADAPTER);
      const report = check(EMPTY_ADAPTER, gaps);
      expect(report.missing).toContain('prompt');
    });
  });

  describe('gap findings', () => {
    it('reports a gap finding for compare-set which the adapter did not implement', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      const compareFinding = report.findings.find(
        (f) => f.component === 'compare-set',
      );
      expect(compareFinding?.kind).toBe('gap');
    });

    it('gap finding carries the screen id where the block appears', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      const compareFinding = report.findings.find(
        (f) => f.component === 'compare-set',
      );
      expect(compareFinding?.screenId).toBe('screen-1');
    });

    it('produces one finding per gap record returned by render()', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      // compare-set (screen-1) and input-set (screen-2) are unimplemented
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      expect(report.findings).toHaveLength(2);
    });

    it('no findings when all components are implemented and none throw', () => {
      // Journey with only implemented components
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [{
          id: 'screen-1',
          purpose: 'Only prompt.',
          blocks: [{ component: 'prompt', props: { heading: 'Hi' } }],
          actions: [],
          annotations: [],
        }],
      };
      const { gaps } = render(journey, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      expect(report.findings).toHaveLength(0);
    });
  });

  describe('defect vs gap distinction', () => {
    it('classifies a gap for a component NOT in the adapter as kind=gap', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      const f = report.findings.find((x) => x.component === 'compare-set');
      expect(f?.kind).toBe('gap');
    });

    it('classifies a gap for a component that IS in the adapter but threw as kind=defect', () => {
      // THROWING_ADAPTER has prompt but it always throws, so render() records
      // a gap for prompt with the error text. gate should classify it as defect.
      const { gaps } = render(MINIMAL_JOURNEY, THROWING_ADAPTER);
      const report = check(THROWING_ADAPTER, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('defect');
    });

    it('defect finding carries the renderer error message from the real render output', () => {
      const { gaps } = render(MINIMAL_JOURNEY, THROWING_ADAPTER);
      const report = check(THROWING_ADAPTER, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('defect');
      // The error field must reflect the actual thrown message, not 'unknown error'
      expect((f as { kind: 'defect'; error: string } | undefined)?.error).toBe('renderer exploded');
    });

    it('defect finding falls back to "unknown error" when the GapRecord carries no error text', () => {
      // `check()` is public API accepting `renderGaps` directly, so a caller may
      // pass a GapRecord with no `error` field. The fallback `gap.error ?? 'unknown error'`
      // at gate.ts is reachable and must produce the literal string 'unknown error'
      // rather than undefined or an empty string.
      //
      // We pass a hand-crafted GapRecord: the adapter has a `prompt` renderer (so
      // check() classifies the gap as kind='defect'), but the record carries no
      // `error` field — exercising the ?? branch.
      const gapWithNoError = [
        { screenId: 'screen-1', component: 'prompt' },  // no `error` property
      ];
      const report = check(SKETCH_LIKE_ADAPTER, gapWithNoError);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('defect');
      expect((f as { kind: 'defect'; error: string } | undefined)?.error).toBe('unknown error');
    });
  });

  describe('schema finding classification', () => {
    // The gate classifies a GapRecord that carries schemaError as kind='schema'.
    // This is the third finding kind (alongside gap and defect) and represents a
    // data problem: the adapter has a renderer but the block's props are invalid
    // against the port contract, so the renderer was never called.

    it('classifies a gap with schemaError as kind=schema, not gap or defect', () => {
      // SKETCH_LIKE_ADAPTER has a prompt renderer, but SCHEMA_INVALID_JOURNEY
      // passes invalid props — render() will produce a gap with schemaError set.
      const { gaps } = render(SCHEMA_INVALID_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('schema');
    });

    it('schema finding carries the schemaError message from the gap record', () => {
      const { gaps } = render(SCHEMA_INVALID_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('schema');
      // The schemaError field must be a non-empty string from the Zod failure.
      const schemaFinding = f as { kind: 'schema'; schemaError: string } | undefined;
      expect(typeof schemaFinding?.schemaError).toBe('string');
      expect(schemaFinding?.schemaError.length).toBeGreaterThan(0);
    });

    it('schema finding carries the correct screenId', () => {
      const { gaps } = render(SCHEMA_INVALID_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.screenId).toBe('screen-1');
    });

    it('schema finding does not count prompt as missing even though it did not render', () => {
      // prompt is implemented in SKETCH_LIKE_ADAPTER; the schema failure does not
      // move it from implemented to missing.
      const { gaps } = render(SCHEMA_INVALID_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      expect(report.implemented).toContain('prompt');
      expect(report.missing).not.toContain('prompt');
    });
  });

  describe('report shape is stable', () => {
    it('report has implemented, missing, and findings keys', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, gaps);
      expect(report).toMatchObject({
        implemented: expect.any(Array),
        missing: expect.any(Array),
        findings: expect.any(Array),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ADR 0008 — the adapter contract carries presentation (story 2.2)
  // ---------------------------------------------------------------------------

  describe('adapter contract: check() rejects an incomplete adapter', () => {
    it('throws when the adapter has no styles field', () => {
      const incomplete = {
        name: 'incomplete',
        components: {},
        tokens: {},
      } as unknown as AdapterLike;
      expect(() => check(incomplete, [])).toThrow(/styles/);
    });

    it('throws when the adapter has no tokens field', () => {
      const incomplete = {
        name: 'incomplete',
        components: {},
        styles: '',
      } as unknown as AdapterLike;
      expect(() => check(incomplete, [])).toThrow(/tokens/);
    });
  });

  // ---------------------------------------------------------------------------
  // Story 3.3 — escape hatches: adapter components with no port entry
  // ---------------------------------------------------------------------------

  describe('escape hatches', () => {
    it('reports an adapter component with no port entry as an escape hatch', () => {
      const adapter: AdapterLike = {
        name: 'custom',
        components: {
          prompt: (_props) => '<div class="ds-prompt"></div>',
          'custom-widget': (_props) => '<div class="custom"></div>',
        },
        styles: '',
        tokens: {},
      };
      const report = check(adapter, []);
      expect(report.escapeHatches).toEqual([{ kind: 'escapeHatch', component: 'custom-widget' }]);
    });

    it('a port-covered component is never also reported as an escape hatch', () => {
      const report = check(SKETCH_LIKE_ADAPTER, []);
      expect(report.escapeHatches.map((f) => f.component)).not.toContain('prompt');
    });

    it('an escape-hatch component is never counted in implemented (coverage stays exact)', () => {
      const adapter: AdapterLike = {
        name: 'custom',
        components: { 'custom-widget': (_props) => '' },
        styles: '',
        tokens: {},
      };
      const report = check(adapter, []);
      expect(report.implemented).toHaveLength(0);
      expect(report.escapeHatches).toHaveLength(1);
    });

    it('no escape hatches when every adapter component is in the port', () => {
      const report = check(SKETCH_LIKE_ADAPTER, []);
      expect(report.escapeHatches).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Story 3.3 — token resolution
  // ---------------------------------------------------------------------------

  describe('unresolved tokens', () => {
    it('reports a var(--x) reference in styles with no matching tokens entry', () => {
      const adapter: AdapterLike = {
        name: 'gappy-tokens',
        components: {},
        styles: '.ds-thing { color: var(--ds-missing); }',
        tokens: {},
      };
      const report = check(adapter, []);
      expect(report.unresolvedTokens).toEqual([{ kind: 'unresolvedToken', token: 'ds-missing' }]);
    });

    it('a token that IS in tokens is not reported as unresolved', () => {
      const adapter: AdapterLike = {
        name: 'resolved-tokens',
        components: {},
        styles: '.ds-thing { color: var(--ds-present); }',
        tokens: { 'ds-present': '#000000' },
      };
      const report = check(adapter, []);
      expect(report.unresolvedTokens).toHaveLength(0);
    });

    it('reports each distinct unresolved token name once, even if referenced in several rules', () => {
      const adapter: AdapterLike = {
        name: 'repeated-reference',
        components: {},
        styles:
          '.a { color: var(--ds-missing); } .b { border-color: var(--ds-missing); }',
        tokens: {},
      };
      const report = check(adapter, []);
      expect(report.unresolvedTokens).toHaveLength(1);
    });

    it('no unresolved tokens when styles references nothing via var()', () => {
      const adapter: AdapterLike = {
        name: 'no-vars',
        components: {},
        styles: '.a { color: #000; }',
        tokens: {},
      };
      const report = check(adapter, []);
      expect(report.unresolvedTokens).toHaveLength(0);
    });

    it('a var(--x, fallback) reference with no matching tokens entry is still detected as an unresolved token, fallback and all', () => {
      // VAR_REFERENCE_PATTERN's trailing `(?:,[^)]*)?` group exists to match
      // this exact fallback shape. Removing that group makes the whole var()
      // fail to match at all when a fallback is present, so the token would
      // silently vanish from this report instead of showing up as unresolved.
      const adapter: AdapterLike = {
        name: 'fallback-reference',
        components: {},
        styles: '.a { color: var(--ds-fallback, red); }',
        tokens: {},
      };
      const report = check(adapter, []);
      expect(report.unresolvedTokens).toEqual([{ kind: 'unresolvedToken', token: 'ds-fallback' }]);
    });
  });

  // ---------------------------------------------------------------------------
  // Story 3.3 — contrast
  // ---------------------------------------------------------------------------

  describe('contrast', () => {
    it('measures and passes a black-on-white pair against the default 4.5 bar', () => {
      const adapter: AdapterLike = {
        name: 'contrast-ok',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { fg: '#000000', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(1);
      expect(report.contrast[0]?.passes).toBe(true);
      // Black on white is the maximum possible WCAG ratio, 21:1.
      expect(report.contrast[0]?.ratio).toBeCloseTo(21, 1);
      expect(report.contrast[0]?.bar).toBe(4.5);
    });

    it('measures and fails a low-contrast pair against the default bar', () => {
      const adapter: AdapterLike = {
        name: 'contrast-bad',
        components: {},
        styles: '.ds-thing { color: var(--fg); background-color: var(--bg); }',
        tokens: { fg: '#777777', bg: '#888888' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(1);
      expect(report.contrast[0]?.passes).toBe(false);
      expect(report.contrast[0]?.ratio).toBeLessThan(4.5);
    });

    it('honours an overridden contrast bar', () => {
      const adapter: AdapterLike = {
        name: 'contrast-strict',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        // A real pair that clears 4.5 but not a much stricter 20:1 bar.
        tokens: { fg: '#333333', bg: '#ffffff' },
      };
      const defaultReport = check(adapter, [], {});
      const strictReport = check(adapter, [], { contrastBar: 20 });
      expect(defaultReport.contrast[0]?.passes).toBe(true);
      expect(strictReport.contrast[0]?.bar).toBe(20);
      expect(strictReport.contrast[0]?.passes).toBe(false);
    });

    it('a rule with color but no background in the same block is not counted at all', () => {
      const adapter: AdapterLike = {
        name: 'color-only',
        components: {},
        styles: '.ds-thing { color: var(--fg); }',
        tokens: { fg: '#000000' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(0);
      expect(report.unmeasurableContrast).toHaveLength(0);
    });

    it('a named CSS colour is reported as unmeasurable, never guessed at as a pass or fail', () => {
      const adapter: AdapterLike = {
        name: 'named-colour',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { fg: 'chartreuse', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(0);
      expect(report.unmeasurableContrast).toEqual([
        {
          kind: 'unmeasurableContrast',
          selector: '.ds-thing',
          foregroundToken: 'fg',
          backgroundToken: 'bg',
          foregroundValue: 'chartreuse',
          backgroundValue: '#ffffff',
        },
      ]);
    });

    it('a partial-alpha rgba() value is unmeasurable, not composited or guessed', () => {
      const adapter: AdapterLike = {
        name: 'partial-alpha',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { fg: 'rgba(0, 0, 0, 0.5)', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(0);
      expect(report.unmeasurableContrast).toHaveLength(1);
    });

    it('an opaque rgba() (alpha 1) is measured like a solid colour', () => {
      const adapter: AdapterLike = {
        name: 'opaque-rgba',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { fg: 'rgba(0, 0, 0, 1)', bg: 'rgb(255, 255, 255)' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(1);
      expect(report.contrast[0]?.passes).toBe(true);
    });

    it('a pair where either token is unresolved never appears in contrast or unmeasurableContrast — it is only an unresolved-token finding', () => {
      const adapter: AdapterLike = {
        name: 'unresolved-pair',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { bg: '#ffffff' }, // fg is never defined
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(0);
      expect(report.unmeasurableContrast).toHaveLength(0);
      expect(report.unresolvedTokens).toEqual([{ kind: 'unresolvedToken', token: 'fg' }]);
    });

    it('background before color in declaration order is still recognised as a pair', () => {
      const adapter: AdapterLike = {
        name: 'reversed-order',
        components: {},
        styles: '.ds-thing { background: var(--bg); color: var(--fg); }',
        tokens: { fg: '#000000', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(1);
    });

    it('3-digit hex shorthand is parsed correctly', () => {
      const adapter: AdapterLike = {
        name: 'hex3',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { fg: '#000', bg: '#fff' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(1);
      expect(report.contrast[0]?.ratio).toBeCloseTo(21, 1);
    });

    it('an out-of-range rgb() channel value is reported as unmeasurable, not silently clamped or passed', () => {
      // isByte's bounds check (0-255) is what excludes this — mutating isByte
      // to always return true would let 999 through as a real channel value
      // and this pair would wrongly end up in `contrast` instead of here.
      const adapter: AdapterLike = {
        name: 'out-of-range-rgb',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { fg: 'rgb(999, 0, 0)', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(0);
      expect(report.unmeasurableContrast).toHaveLength(1);
      expect(report.unmeasurableContrast[0]?.foregroundValue).toBe('rgb(999, 0, 0)');
      expect(report.unmeasurableContrast[0]?.backgroundValue).toBe('#ffffff');
    });

    it('a background declaration mixing a colour token with other content (e.g. an image layer) is unmeasurable, not silently measured', () => {
      // The exact shape docs finding 1 traced: an unanchored background
      // pattern used to grab just the `--bg` token and silently discard
      // `url(hero.png) no-repeat`, reporting a confident pass/fail for a
      // declaration that is not actually a flat colour. It must now be
      // recognised as carrying more than a single colour reference.
      const adapter: AdapterLike = {
        name: 'mixed-background',
        components: {},
        styles: '.hero { color: var(--fg); background: var(--bg) url(hero.png) no-repeat; }',
        tokens: { fg: '#000000', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.contrast).toHaveLength(0);
      expect(report.unmeasurableContrast).toEqual([
        {
          kind: 'unmeasurableContrast',
          selector: '.hero',
          foregroundToken: 'fg',
          backgroundToken: 'bg',
          foregroundValue: '#000000',
          backgroundValue: 'var(--bg) url(hero.png) no-repeat',
        },
      ]);
    });

    it('!important trailing a single var() reference does not make the declaration impure — it is still measured', () => {
      const adapter: AdapterLike = {
        name: 'important-trailing',
        components: {},
        styles: '.ds-thing { color: var(--fg) !important; background: var(--bg); }',
        tokens: { fg: '#000000', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.unmeasurableContrast).toHaveLength(0);
      expect(report.contrast).toHaveLength(1);
      expect(report.contrast[0]?.passes).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Story 3.3 — the four kinds stay distinguishable
  // ---------------------------------------------------------------------------

  describe('the four counted facts are distinguishable from each other', () => {
    it('a missing component, an escape hatch, an unresolved token, and a contrast fail all report under different, distinct kinds', () => {
      const adapter: AdapterLike = {
        name: 'everything-at-once',
        components: {
          prompt: (_props) => '<div class="ds-prompt"></div>',
          'custom-widget': (_props) => '<div class="custom"></div>',
        },
        styles:
          '.ds-thing { color: var(--fg); background: var(--bg); } .ds-other { border-color: var(--ds-orphan); }',
        tokens: { fg: '#777777', bg: '#888888' }, // fails contrast at the default bar
      };
      const report = check(adapter, []);

      expect(report.missing).toContain('compare-set'); // missing coverage
      expect(report.escapeHatches).toEqual([{ kind: 'escapeHatch', component: 'custom-widget' }]);
      expect(report.unresolvedTokens).toEqual([{ kind: 'unresolvedToken', token: 'ds-orphan' }]);
      expect(report.contrast[0]?.passes).toBe(false);
      expect(report.contrast[0]?.kind).toBe('contrast');

      // Every kind present is a different string — a reader can always tell which is which.
      const kindsPresent = new Set([
        ...report.escapeHatches.map((f) => f.kind),
        ...report.unresolvedTokens.map((f) => f.kind),
        ...report.contrast.map((f) => f.kind),
      ]);
      expect(kindsPresent).toEqual(new Set(['escapeHatch', 'unresolvedToken', 'contrast']));
    });
  });

  describe('WCAG21_AA_NORMAL_TEXT_CONTRAST', () => {
    it('is the documented default, 4.5', () => {
      expect(WCAG21_AA_NORMAL_TEXT_CONTRAST).toBe(4.5);
    });

    it('is what check() uses when no contrastBar option is given', () => {
      const adapter: AdapterLike = {
        name: 'default-bar',
        components: {},
        styles: '.ds-thing { color: var(--fg); background: var(--bg); }',
        tokens: { fg: '#000000', bg: '#ffffff' },
      };
      const report = check(adapter, []);
      expect(report.contrast[0]?.bar).toBe(WCAG21_AA_NORMAL_TEXT_CONTRAST);
    });
  });

  // ---------------------------------------------------------------------------
  // Story 3.3 — renderGaps is genuinely optional, not just optional in the type
  // ---------------------------------------------------------------------------

  describe('renderGaps default parameter', () => {
    it('check(adapter) with renderGaps omitted entirely returns empty findings rather than throwing', () => {
      // Every other call in this file supplies renderGaps explicitly (at least
      // `[]`), so none of them would notice the default disappearing. This
      // calls check() with the second argument genuinely absent — the one
      // shape that actually exercises the default `= []` on `check()`'s own
      // signature, which the function's doc-comment advertises as the point
      // of this story: coverage, escape hatches, tokens and contrast need no
      // render() call at all.
      const report = check(SKETCH_LIKE_ADAPTER);
      expect(report.findings).toEqual([]);
      expect(report.implemented).toContain('prompt');
    });
  });
});
