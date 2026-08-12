import { describe, it, expect } from 'vitest';
import { render } from './render.js';
import type { JourneyDocument } from '@design-space/journey-model';
import type { AdapterLike } from './render.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_JOURNEY: JourneyDocument = {
  id: 'test-journey',
  title: 'Test Journey',
  intent: 'Proves the render chain.',
  entry: 'screen-a',
  screens: [
    {
      id: 'screen-a',
      purpose: 'First screen.',
      blocks: [
        { component: 'prompt', props: { heading: 'Hello world', explain: 'A test screen.' } },
        { component: 'unknown-widget', props: { foo: 'bar' } },
      ],
      actions: [
        { label: 'Continue', weight: 'primary', target: 'screen-b' },
        { label: 'Leave', weight: 'escape', target: null },
      ],
      annotations: [],
    },
    {
      id: 'screen-b',
      purpose: 'Second screen.',
      blocks: [
        { component: 'another-missing', props: {} },
      ],
      actions: [],
      annotations: [],
    },
  ],
};

const PROMPT_ONLY_ADAPTER: AdapterLike = {
  name: 'test-adapter',
  components: {
    prompt: (props) => {
      const p = props as { heading: string; explain?: string };
      return `<div class="ds-prompt"><h1>${p.heading}</h1></div>`;
    },
  },
};

const EMPTY_ADAPTER: AdapterLike = {
  name: 'empty-adapter',
  components: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('render()', () => {
  describe('output is a valid standalone HTML document', () => {
    it('includes a DOCTYPE declaration', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toMatch(/^<!DOCTYPE html>/i);
    });

    it('includes an inline <style> block so the document needs no external assets', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('<style>');
    });

    it('includes the journey title in the document', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('Test Journey');
    });
  });

  describe('prompt component renders its heading text', () => {
    it('contains the heading text from the prompt block props', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('Hello world');
    });
  });

  describe('gap: unimplemented component produces a visible labelled gap', () => {
    it('renders a gap element for unknown-widget instead of silently omitting it', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      // Must contain the component name — not silently omitted
      expect(html).toContain('unknown-widget');
    });

    it('renders the gap with the ds-gap class so it is visually distinct', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('class="ds-gap"');
    });

    it('records every gap in the gaps array', () => {
      const { gaps } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      const gapComponents = gaps.map((g) => g.component);
      expect(gapComponents).toContain('unknown-widget');
      expect(gapComponents).toContain('another-missing');
    });

    it('records the screen id alongside each gap', () => {
      const { gaps } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      const unknownGap = gaps.find((g) => g.component === 'unknown-widget');
      expect(unknownGap?.screenId).toBe('screen-a');
    });

    it('gap element carries an aria-label naming the component', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('aria-label="Gap: unknown-widget"');
    });
  });

  describe('silent omission — the critical negative case', () => {
    it('the HTML length WITHOUT the gap content is less than WITH it, proving the gap is present not absent', () => {
      // Build a version with no adapter at all and one where unknown-widget renders
      const withGap = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      // Remove unknown-widget from the document and confirm it is shorter
      const withoutGapText = withGap.html.replace(/unknown-widget/, 'REDACTED');
      expect(withGap.html).not.toEqual(withoutGapText);
    });

    it('when adapter has NO components, every block in every screen produces a gap record', () => {
      const { gaps } = render(MINIMAL_JOURNEY, EMPTY_ADAPTER);
      // screen-a has 2 blocks, screen-b has 1
      expect(gaps).toHaveLength(3);
    });

    it('when adapter has NO components, the HTML still contains the component names (not empty)', () => {
      const { html } = render(MINIMAL_JOURNEY, EMPTY_ADAPTER);
      expect(html).toContain('unknown-widget');
      expect(html).toContain('another-missing');
      expect(html).toContain('prompt');
    });
  });

  describe('navigation: screen links use anchor hrefs targeting screen ids', () => {
    it('action with a target screen generates an href pointing to that screen', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('href="#screen-screen-b"');
    });

    it('action with null target generates href="#"', () => {
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      // Leave action has target: null
      expect(html).toContain('href="#"');
    });
  });

  describe('html escaping protects against XSS in journey data', () => {
    it('special characters in heading are HTML-escaped', () => {
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [
          {
            ...MINIMAL_JOURNEY.screens[0]!,
            blocks: [
              { component: 'prompt', props: { heading: '<script>alert(1)</script>', explain: undefined } },
            ],
          },
          MINIMAL_JOURNEY.screens[1]!,
        ],
      };
      const { html } = render(journey, PROMPT_ONLY_ADAPTER);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('a journey with only the prompt component implemented', () => {
    it('produces exactly the right number of gap records for the broadband-switch shape', () => {
      // 5 screens, each with a prompt block, plus other blocks that are all gaps
      // screen-a: 2 blocks (1 prompt = rendered, 1 unknown = gap)
      // screen-b: 1 block (1 another-missing = gap)
      const { gaps } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      // prompt is implemented; unknown-widget and another-missing are gaps
      expect(gaps.map((g) => g.component).sort()).toEqual(['another-missing', 'unknown-widget']);
    });
  });
});
