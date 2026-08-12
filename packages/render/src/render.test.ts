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
    it('the gap element for an unimplemented component is present in the HTML, not silently omitted', () => {
      // Directly assert the gap element IS in the output — both the ds-gap marker
      // and the component name must appear, proving the block was rendered as a gap
      // rather than being dropped silently.
      const { html } = render(MINIMAL_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('class="ds-gap"');
      expect(html).toContain('unknown-widget');
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

    it('action whose target is not null but does not exist in allScreenIds falls through to href="#"', () => {
      // A non-null target that is NOT in the screen set (dangling reference) must
      // produce href="#" rather than a broken anchor — the guard is
      // `target !== null && allScreenIds.has(target)`.
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [
          {
            id: 'screen-a',
            purpose: 'Only screen.',
            blocks: [],
            actions: [
              // 'screen-gone' does not exist in the journey — dangling target
              { label: 'Go somewhere', weight: 'primary', target: 'screen-gone' },
            ],
            annotations: [],
          },
        ],
      };
      const { html } = render(journey, EMPTY_ADAPTER);
      // The anchor must not contain 'screen-gone' in its href — it should fall through to '#'
      expect(html).toContain('href="#"');
      expect(html).not.toContain('href="#screen-screen-gone"');
    });
  });

  describe('html escaping protects against XSS in journey metadata', () => {
    it("single quotes in a screen's purpose are escaped as &#39; in the aria-label attribute", () => {
      // escapeAttr() replaces single quotes with &#39; to prevent attribute injection.
      // This test asserts on the ATTRIBUTE value (aria-label), not the element text,
      // because escapeHtml (used for text content) does not escape single quotes.
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [
          {
            id: 'screen-a',
            purpose: "It's a trap",
            blocks: [],
            actions: [],
            annotations: [],
          },
        ],
      };
      const { html } = render(journey, EMPTY_ADAPTER);
      // The aria-label attribute must carry the escaped form, not a raw single quote
      expect(html).toContain('aria-label="It&#39;s a trap"');
      expect(html).not.toContain("aria-label=\"It's a trap\"");
    });

    it('special characters in the journey title are HTML-escaped in the document title element', () => {
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        title: '<script>alert(1)</script>',
      };
      const { html } = render(journey, PROMPT_ONLY_ADAPTER);
      // The <title> element and the <h1> header must not contain a raw <script> tag
      // The render package escapes journey metadata it controls (title, action labels, etc.)
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&lt;/script&gt;');
    });

    it('special characters in action labels are HTML-escaped', () => {
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [
          {
            ...MINIMAL_JOURNEY.screens[0]!,
            actions: [
              { label: '<b>Click me</b>', weight: 'primary', target: null },
            ],
          },
          MINIMAL_JOURNEY.screens[1]!,
        ],
      };
      const { html } = render(journey, PROMPT_ONLY_ADAPTER);
      expect(html).not.toContain('<b>Click me</b>');
      expect(html).toContain('&lt;b&gt;Click me&lt;/b&gt;');
    });

    it('special characters in a gap component name are HTML-escaped in the gap element', () => {
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [
          {
            ...MINIMAL_JOURNEY.screens[0]!,
            blocks: [
              { component: '<evil>', props: {} },
            ],
            actions: [],
          },
          MINIMAL_JOURNEY.screens[1]!,
        ],
      };
      const { html } = render(journey, EMPTY_ADAPTER);
      // The gap element shows the component name; that name must be escaped
      expect(html).toContain('&lt;evil&gt;');
      expect(html).not.toContain('<<evil>>');
    });

    it('a double-quote in a screen purpose is escaped as &quot; in the aria-label attribute', () => {
      // escapeAttr() replaces double quotes with &quot; to prevent breaking out of
      // a double-quoted HTML attribute. This exercises the '"' branch of escapeAttr
      // in the position it actually appears: aria-label on the <section> element.
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [
          {
            id: 'screen-a',
            purpose: 'Say "hello"',
            blocks: [],
            actions: [],
            annotations: [],
          },
        ],
      };
      const { html } = render(journey, EMPTY_ADAPTER);
      // The attribute must carry &quot; — a raw " would break out of the attribute.
      expect(html).toContain('aria-label="Say &quot;hello&quot;"');
      expect(html).not.toContain('aria-label="Say "hello""');
    });
  });

  describe('unvalidated-component fallback: component with no port schema passes props through', () => {
    // When an adapter implements a component that has no entry in the port
    // (getContract returns undefined), renderBlock passes block.props directly
    // to the renderer without schema validation. This branch is the intentional
    // escape hatch for components that exist in an adapter but not yet in the
    // port contract.

    const CUSTOM_COMPONENT_ADAPTER: AdapterLike = {
      name: 'custom-adapter',
      components: {
        // 'custom-widget' has no port contract — getContract returns undefined for it.
        'custom-widget': (props) => {
          const p = props as { label: string };
          return `<div class="custom">${p.label}</div>`;
        },
      },
    };

    const CUSTOM_WIDGET_JOURNEY: JourneyDocument = {
      id: 'custom-journey',
      title: 'Custom Journey',
      intent: 'Tests the no-port-schema fallback.',
      entry: 'screen-a',
      screens: [
        {
          id: 'screen-a',
          purpose: 'Custom screen.',
          blocks: [
            { component: 'custom-widget', props: { label: 'Hello from custom' } },
          ],
          actions: [],
          annotations: [],
        },
      ],
    };

    it('renders the component output (not a gap) when the adapter has a renderer for an out-of-port component', () => {
      const { html } = render(CUSTOM_WIDGET_JOURNEY, CUSTOM_COMPONENT_ADAPTER);
      // The adapter's renderer output must appear — not a gap element.
      expect(html).toContain('Hello from custom');
      // The gap element uses class="ds-gap" — must not be present.
      // (The CSS in the document references .ds-gap as a rule, so we check for
      // the element's class attribute, not the string 'ds-gap' in isolation.)
      expect(html).not.toContain('class="ds-gap"');
    });

    it('records no gaps when the out-of-port component renders successfully', () => {
      const { gaps } = render(CUSTOM_WIDGET_JOURNEY, CUSTOM_COMPONENT_ADAPTER);
      expect(gaps).toHaveLength(0);
    });

    it('still produces a gap (with error) when the out-of-port renderer throws', () => {
      const THROWING_CUSTOM_ADAPTER: AdapterLike = {
        name: 'throwing-custom-adapter',
        components: {
          'custom-widget': (_props) => {
            throw new Error('custom renderer blew up');
          },
        },
      };
      const { gaps } = render(CUSTOM_WIDGET_JOURNEY, THROWING_CUSTOM_ADAPTER);
      const gap = gaps.find((g) => g.component === 'custom-widget');
      expect(gap).toBeDefined();
      // A renderer throw sets `error`, not `schemaError` — it is an adapter defect.
      expect(gap?.error).toBe('custom renderer blew up');
      expect(gap?.schemaError).toBeUndefined();
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

  describe('schema validation failure: props that violate the port schema', () => {
    // When a block's props fail the component's Zod schema, the adapter renderer
    // is never called — the failure is a data problem, not an adapter defect.
    // render() must record it distinctly via `schemaError`, not `error`.

    const SCHEMA_INVALID_JOURNEY: JourneyDocument = {
      id: 'schema-test',
      title: 'Schema Test',
      intent: 'Verifies schema validation classification.',
      entry: 'screen-a',
      screens: [
        {
          id: 'screen-a',
          purpose: 'Schema failure screen.',
          // heading is required (min(1)), so an empty string fails the schema
          blocks: [{ component: 'prompt', props: { heading: '' } }],
          actions: [],
          annotations: [],
        },
      ],
    };

    it('produces a gap element for the component whose props failed the schema', () => {
      const { html } = render(SCHEMA_INVALID_JOURNEY, PROMPT_ONLY_ADAPTER);
      expect(html).toContain('ds-gap');
      expect(html).toContain('prompt');
    });

    it('records a gap with schemaError set, not error, so the gate classifies it as a data problem not an adapter defect', () => {
      const { gaps } = render(SCHEMA_INVALID_JOURNEY, PROMPT_ONLY_ADAPTER);
      const gap = gaps.find((g) => g.component === 'prompt');
      expect(gap).toBeDefined();
      expect(gap?.schemaError).toBeDefined();
      expect(gap?.error).toBeUndefined();
    });

    it('the schemaError message is not embedded in the shipped HTML', () => {
      const { html, gaps } = render(SCHEMA_INVALID_JOURNEY, PROMPT_ONLY_ADAPTER);
      const gap = gaps.find((g) => g.component === 'prompt');
      // The schema error text must be present on the gap record…
      expect(gap?.schemaError).toBeTruthy();
      // …but must NOT appear in the document (internal Zod messages stay off the page).
      expect(html).not.toContain(gap?.schemaError);
    });
  });

  describe('security: internal exception text never reaches shipped HTML', () => {
    // When a renderer throws, the error message must be kept out of the HTML
    // document — it may contain internal stack frames, sensitive values, or
    // library internals that callers must not receive. The gap element names
    // the component (so the gap is visible) but carries no exception detail.

    const SECRET_ERROR_TEXT = 'INTERNAL_EXCEPTION_DO_NOT_SHIP_abc123';

    const THROWING_ADAPTER: AdapterLike = {
      name: 'throwing-adapter',
      components: {
        prompt: (_props) => {
          throw new Error(SECRET_ERROR_TEXT);
        },
      },
    };

    it('the rendered HTML does not contain the internal exception message when a renderer throws', () => {
      const { html } = render(MINIMAL_JOURNEY, THROWING_ADAPTER);
      expect(html).not.toContain(SECRET_ERROR_TEXT);
    });

    it('a gap element IS present for the component that threw — the gap is visible, not silently dropped', () => {
      const { html } = render(MINIMAL_JOURNEY, THROWING_ADAPTER);
      expect(html).toContain('ds-gap');
      expect(html).toContain('prompt');
    });

    it('the gap record carries the exception message for gate inspection, but not the HTML', () => {
      const { html, gaps } = render(MINIMAL_JOURNEY, THROWING_ADAPTER);
      // The gap record DOES carry the error (for gate.ts to read).
      const promptGap = gaps.find((g) => g.component === 'prompt');
      expect(promptGap?.error).toBe(SECRET_ERROR_TEXT);
      // But the shipped HTML does NOT contain it.
      expect(html).not.toContain(SECRET_ERROR_TEXT);
    });

    it('the gap element still names the component (visible gap, not a blank box)', () => {
      const journey: JourneyDocument = {
        ...MINIMAL_JOURNEY,
        screens: [{
          id: 'screen-a',
          purpose: 'Throwing screen.',
          blocks: [{ component: 'prompt', props: { heading: 'Hi' } }],
          actions: [],
          annotations: [],
        }],
      };
      const { html } = render(journey, THROWING_ADAPTER);
      // The gap element must name the component so the developer knows which one failed.
      expect(html).toContain('aria-label="Gap: prompt"');
    });
  });
});
