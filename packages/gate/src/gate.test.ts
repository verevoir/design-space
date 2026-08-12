import { describe, it, expect } from 'vitest';
import { check } from './gate.js';
import type { JourneyDocument } from '@design-space/journey-model';
import type { AdapterLike, GapRecord } from './adapter-like.js';

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

/** Adapter that only implements prompt — the sole port component in wave 2S.1. */
const SKETCH_LIKE_ADAPTER: AdapterLike = {
  name: 'sketch',
  components: {
    prompt: (props) => `<div>${JSON.stringify(props)}</div>`,
  },
};

/** Adapter that implements nothing. */
const EMPTY_ADAPTER: AdapterLike = {
  name: 'empty',
  components: {},
};

/** Gaps as they would be produced by render() for the journey above with the sketch adapter. */
const SKETCH_GAPS: GapRecord[] = [
  { screenId: 'screen-1', component: 'compare-set' },
  { screenId: 'screen-2', component: 'input-set' },
];

/** No gaps — adapter implemented every component. */
const NO_GAPS: GapRecord[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('check()', () => {
  describe('implemented components', () => {
    it('lists prompt as implemented when the adapter has a prompt renderer', () => {
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, SKETCH_GAPS);
      expect(report.implemented).toContain('prompt');
    });

    it('implemented list is empty when the adapter has no components', () => {
      const report = check(EMPTY_ADAPTER, MINIMAL_JOURNEY, NO_GAPS);
      expect(report.implemented).toHaveLength(0);
    });
  });

  describe('missing components', () => {
    it('lists no port components as missing when prompt-only adapter is used (prompt is the only port component)', () => {
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, SKETCH_GAPS);
      // The port only defines "prompt" in wave 2S.1, so nothing is missing
      expect(report.missing).toHaveLength(0);
    });

    it('lists prompt as missing when the adapter has no components', () => {
      const report = check(EMPTY_ADAPTER, MINIMAL_JOURNEY, NO_GAPS);
      expect(report.missing).toContain('prompt');
    });
  });

  describe('gap findings', () => {
    it('reports a gap finding for compare-set which the adapter did not implement', () => {
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, SKETCH_GAPS);
      const compareFinding = report.findings.find(
        (f) => f.component === 'compare-set',
      );
      expect(compareFinding?.kind).toBe('gap');
    });

    it('gap finding carries the screen id where the block appears', () => {
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, SKETCH_GAPS);
      const compareFinding = report.findings.find(
        (f) => f.component === 'compare-set',
      );
      expect(compareFinding?.screenId).toBe('screen-1');
    });

    it('produces one finding per gap record passed in', () => {
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, SKETCH_GAPS);
      expect(report.findings).toHaveLength(2);
    });

    it('no findings when no gaps are passed in', () => {
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, NO_GAPS);
      expect(report.findings).toHaveLength(0);
    });
  });

  describe('defect vs gap distinction', () => {
    it('classifies a gap for a component NOT in the adapter as kind=gap', () => {
      const gaps: GapRecord[] = [{ screenId: 'screen-1', component: 'missing-widget' }];
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      const f = report.findings.find((x) => x.component === 'missing-widget');
      expect(f?.kind).toBe('gap');
    });

    it('classifies a gap for a component that IS in the adapter as kind=defect', () => {
      // Simulate: adapter HAS prompt, but render detected it threw and recorded a gap for it
      const gaps: GapRecord[] = [{ screenId: 'screen-1', component: 'prompt' }];
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('defect');
    });
  });

  describe('report shape is stable', () => {
    it('report has implemented, missing, and findings keys', () => {
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, SKETCH_GAPS);
      expect(report).toMatchObject({
        implemented: expect.any(Array),
        missing: expect.any(Array),
        findings: expect.any(Array),
      });
    });
  });
});
