import { describe, it, expect } from 'vitest';
import { check } from './gate.js';
import { render } from '@design-space/render';
import type { JourneyDocument } from '@design-space/journey-model';
import type { AdapterLike } from './adapter-like.js';

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
    prompt: (_props) => `<div class="ds-prompt">Prompt</div>`,
  },
};

/** Adapter that implements nothing. */
const EMPTY_ADAPTER: AdapterLike = {
  name: 'empty',
  components: {},
};

/** Adapter where prompt exists but always throws — simulates a renderer defect. */
const THROWING_ADAPTER: AdapterLike = {
  name: 'throwing',
  components: {
    prompt: (_props) => { throw new Error('renderer exploded'); },
  },
};

// ---------------------------------------------------------------------------
// Tests — gaps come from a real render() call, not a hand-made fixture
// ---------------------------------------------------------------------------

describe('check()', () => {
  describe('implemented components', () => {
    it('lists prompt as implemented when the adapter has a prompt renderer', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      expect(report.implemented).toContain('prompt');
    });

    it('implemented list is empty when the adapter has no components', () => {
      const { gaps } = render(MINIMAL_JOURNEY, EMPTY_ADAPTER);
      const report = check(EMPTY_ADAPTER, MINIMAL_JOURNEY, gaps);
      expect(report.implemented).toHaveLength(0);
    });
  });

  describe('missing components', () => {
    it('lists no port components as missing when prompt-only adapter is used (prompt is the only port component)', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      // The port only defines "prompt" in wave 2S.1, so nothing is missing
      expect(report.missing).toHaveLength(0);
    });

    it('lists prompt as missing when the adapter has no components', () => {
      const { gaps } = render(MINIMAL_JOURNEY, EMPTY_ADAPTER);
      const report = check(EMPTY_ADAPTER, MINIMAL_JOURNEY, gaps);
      expect(report.missing).toContain('prompt');
    });
  });

  describe('gap findings', () => {
    it('reports a gap finding for compare-set which the adapter did not implement', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      const compareFinding = report.findings.find(
        (f) => f.component === 'compare-set',
      );
      expect(compareFinding?.kind).toBe('gap');
    });

    it('gap finding carries the screen id where the block appears', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      const compareFinding = report.findings.find(
        (f) => f.component === 'compare-set',
      );
      expect(compareFinding?.screenId).toBe('screen-1');
    });

    it('produces one finding per gap record returned by render()', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      // compare-set (screen-1) and input-set (screen-2) are unimplemented
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
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
      const report = check(SKETCH_LIKE_ADAPTER, journey, gaps);
      expect(report.findings).toHaveLength(0);
    });
  });

  describe('defect vs gap distinction', () => {
    it('classifies a gap for a component NOT in the adapter as kind=gap', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      const f = report.findings.find((x) => x.component === 'compare-set');
      expect(f?.kind).toBe('gap');
    });

    it('classifies a gap for a component that IS in the adapter but threw as kind=defect', () => {
      // THROWING_ADAPTER has prompt but it always throws, so render() records
      // a gap for prompt with the error text. gate should classify it as defect.
      const { gaps } = render(MINIMAL_JOURNEY, THROWING_ADAPTER);
      const report = check(THROWING_ADAPTER, MINIMAL_JOURNEY, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('defect');
    });

    it('defect finding carries the renderer error message from the real render output', () => {
      const { gaps } = render(MINIMAL_JOURNEY, THROWING_ADAPTER);
      const report = check(THROWING_ADAPTER, MINIMAL_JOURNEY, gaps);
      const f = report.findings.find((x) => x.component === 'prompt');
      expect(f?.kind).toBe('defect');
      // The error field must reflect the actual thrown message, not 'unknown error'
      expect((f as { kind: 'defect'; error: string } | undefined)?.error).toBe('renderer exploded');
    });
  });

  describe('report shape is stable', () => {
    it('report has implemented, missing, and findings keys', () => {
      const { gaps } = render(MINIMAL_JOURNEY, SKETCH_LIKE_ADAPTER);
      const report = check(SKETCH_LIKE_ADAPTER, MINIMAL_JOURNEY, gaps);
      expect(report).toMatchObject({
        implemented: expect.any(Array),
        missing: expect.any(Array),
        findings: expect.any(Array),
      });
    });
  });
});
