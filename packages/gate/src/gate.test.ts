import { describe, it, expect } from 'vitest';
import { check } from './gate.js';
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
});
