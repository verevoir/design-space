import { describe, it, expect } from 'vitest';
import { sketchAdapter } from './adapter.js';
import {
  PORT_COMPONENTS,
  type PromptProps,
  type CompareSetProps,
  type InputSetProps,
  type StatusProps,
  type OptionListProps,
  type SummaryProps,
} from '@design-space/port';
import base from '../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import postcodeFirst from '../../../examples/journeys/broadband-switch.postcode-first.json' with { type: 'json' };

// Minimal local shape for the fixtures — deliberately not importing
// @design-space/journey-model just for a test helper; adapter-sketch's own
// source never needs the journey model, and adding it as a dependency for
// one test file's typing would be a wider change than this story needs.
interface FixtureBlock {
  readonly component: string;
  readonly props: unknown;
}
interface FixtureScreen {
  readonly blocks: readonly FixtureBlock[];
}
interface FixtureJourney {
  readonly screens: readonly FixtureScreen[];
}

const BASE = base as unknown as FixtureJourney;
const POSTCODE_FIRST = postcodeFirst as unknown as FixtureJourney;

function blocksNamed(journey: FixtureJourney, component: string): readonly FixtureBlock[] {
  return journey.screens.flatMap((s) => s.blocks).filter((b) => b.component === component);
}

// ---------------------------------------------------------------------------
// sketchAdapter — direct tests of the shipped adapter's prompt renderer
//
// All other tests in the repo use stub adapters, so this file provides the
// only direct coverage of the real component sketchAdapter ships.
// ---------------------------------------------------------------------------

describe('sketchAdapter', () => {
  describe('identity', () => {
    it('is named "sketch"', () => {
      expect(sketchAdapter.name).toBe('sketch');
    });

    it('exposes a prompt renderer', () => {
      expect(typeof sketchAdapter.components['prompt']).toBe('function');
    });
  });

  describe('prompt renderer', () => {
    function renderPrompt(props: PromptProps): string {
      return sketchAdapter.components['prompt']!(props as unknown);
    }

    it('renders the heading text inside an h1 element', () => {
      const html = renderPrompt({ heading: 'Choose your plan' });
      expect(html).toContain('<h1');
      expect(html).toContain('Choose your plan');
      expect(html).toContain('</h1>');
    });

    it('uses the ds-prompt class so the render layer can apply its CSS', () => {
      const html = renderPrompt({ heading: 'Hello' });
      expect(html).toContain('ds-prompt');
    });

    it('renders the optional explain text when provided', () => {
      const html = renderPrompt({ heading: 'Title', explain: 'This is the explanation.' });
      expect(html).toContain('This is the explanation.');
      expect(html).toContain('ds-prompt__explain');
    });

    it('omits the explain element entirely when explain is undefined', () => {
      const html = renderPrompt({ heading: 'Title only' });
      expect(html).not.toContain('ds-prompt__explain');
      expect(html).not.toContain('<p');
    });

    it('HTML-escapes special characters in the heading to prevent XSS', () => {
      const html = renderPrompt({ heading: '<script>alert(1)</script>' });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('HTML-escapes special characters in the explain text to prevent XSS', () => {
      const html = renderPrompt({ heading: 'Safe', explain: '<img src=x onerror=alert(1)>' });
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('ampersands in heading are escaped as &amp;', () => {
      const html = renderPrompt({ heading: 'Cats & Dogs' });
      expect(html).toContain('Cats &amp; Dogs');
      expect(html).not.toContain('Cats & Dogs');
    });

    it('double-quotes in heading are escaped as &quot; to stay safe inside HTML attributes', () => {
      const html = renderPrompt({ heading: 'Say "hello"' });
      expect(html).toContain('Say &quot;hello&quot;');
      expect(html).not.toContain('Say "hello"');
    });

    it('double-quotes in explain text are escaped as &quot;', () => {
      const html = renderPrompt({ heading: 'Title', explain: 'Click "OK" to continue.' });
      expect(html).toContain('Click &quot;OK&quot; to continue.');
      expect(html).not.toContain('Click "OK"');
    });
  });

  describe('contract fields added by ADR 0008', () => {
    it('supplies a non-empty styles string', () => {
      expect(typeof sketchAdapter.styles).toBe('string');
      expect(sketchAdapter.styles.length).toBeGreaterThan(0);
    });

    it('supplies a tokens record including the sketch design tokens', () => {
      expect(sketchAdapter.tokens['ds-ink']).toBe('#2b2b2b');
      expect(sketchAdapter.tokens['ds-paper']).toBe('#f0eee9');
    });
  });
});

// ---------------------------------------------------------------------------
// Story 3.1 — every port component has a sketch renderer
// ---------------------------------------------------------------------------

describe('sketchAdapter implements every port component (story 3.1)', () => {
  it('has a renderer for every component the port declares — zero missing', () => {
    const missing = Object.keys(PORT_COMPONENTS).filter(
      (name) => !Object.prototype.hasOwnProperty.call(sketchAdapter.components, name),
    );
    expect(missing).toEqual([]);
  });
});

describe('sketchAdapter — compare-set renderer', () => {
  function renderCompareSet(props: CompareSetProps): string {
    return sketchAdapter.components['compare-set']!(props as unknown);
  }

  it('renders every attribute as a column header', () => {
    const html = renderCompareSet({
      attributes: ['Speed', 'Price'],
      items: [{ name: 'Basic', values: ['10 Mb', '£10'] }],
    });
    expect(html).toContain('<th scope="col">Speed</th>');
    expect(html).toContain('<th scope="col">Price</th>');
  });

  it('renders every item as a row header with its values as cells', () => {
    const html = renderCompareSet({
      attributes: ['Speed'],
      items: [{ name: 'Basic', values: ['10 Mb'] }],
    });
    expect(html).toContain('<th scope="row"');
    expect(html).toContain('Basic');
    expect(html).toContain('<td>10 Mb</td>');
  });

  it('marks an emphasised item with a hand-drawn glyph and a distinct row class, not a colour fill', () => {
    const html = renderCompareSet({
      attributes: ['Speed'],
      items: [{ name: 'Family', values: ['67 Mb'], emphasis: true }],
    });
    expect(html).toContain('ds-compare-set__item--emphasis');
    expect(html).toContain('ds-compare-set__emphasis-mark');
  });

  it('renders the emphasis mark as a rough inline SVG — monochrome by construction, not the borrowed ✦ character', () => {
    const html = renderCompareSet({
      attributes: ['Speed'],
      items: [{ name: 'Family', values: ['67 Mb'], emphasis: true }],
    });
    expect(html).toContain('<svg');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('fill="none"');
    expect(html).not.toContain('✦');
  });

  it('does not mark a non-emphasised item', () => {
    const html = renderCompareSet({
      attributes: ['Speed'],
      items: [{ name: 'Essential', values: ['36 Mb'] }],
    });
    expect(html).not.toContain('ds-compare-set__item--emphasis');
    expect(html).not.toContain('ds-compare-set__emphasis-mark');
  });

  it('carries the emphasis meaning for screen readers too, not only via the hidden glyph', () => {
    const html = renderCompareSet({
      attributes: ['Speed'],
      items: [{ name: 'Family', values: ['67 Mb'], emphasis: true }],
    });
    expect(html).toContain('ds-visually-hidden');
    expect(html).toContain('Recommended');
  });

  it('renders the real base-journey compare-set instance: Family is marked, Essential and Full Fibre are not', () => {
    const [block] = blocksNamed(BASE, 'compare-set');
    const html = renderCompareSet(block!.props as unknown as CompareSetProps);
    expect(html).toContain('Family');
    expect(html).toContain('Essential');
    expect(html).toContain('Full Fibre');
    expect(html.match(/ds-compare-set__item--emphasis/g)).toHaveLength(1);
  });

  it('renders the real postcode-first compare-set instance, where Full Fibre (not Family) is emphasised', () => {
    const [block] = blocksNamed(POSTCODE_FIRST, 'compare-set');
    const html = renderCompareSet(block!.props as unknown as CompareSetProps);
    expect(html).toContain('Full Fibre');
    expect(html.match(/ds-compare-set__item--emphasis/g)).toHaveLength(1);
  });

  it('escapes a hostile item name so it cannot break out of the table cell', () => {
    const html = renderCompareSet({
      attributes: ['Speed'],
      items: [{ name: '<script>alert(1)</script>', values: ['10 Mb'] }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a hostile value so it cannot break out of the table cell', () => {
    const html = renderCompareSet({
      attributes: ['Speed'],
      items: [{ name: 'Basic', values: ['<img src=x onerror=alert(1)>'] }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes a hostile attribute name', () => {
    const html = renderCompareSet({
      attributes: ['"><script>alert(1)</script>'],
      items: [{ name: 'Basic', values: ['x'] }],
    });
    expect(html).not.toContain('<script>');
  });
});

describe('sketchAdapter — input-set renderer', () => {
  function renderInputSet(props: InputSetProps): string {
    return sketchAdapter.components['input-set']!(props as unknown);
  }

  it('associates each label with its control via for/id', () => {
    const html = renderInputSet({ fields: [{ label: 'Postcode', kind: 'text', required: true }] });
    const idMatch = html.match(/id="([^"]+)"/);
    expect(idMatch).not.toBeNull();
    expect(html).toContain(`for="${idMatch![1]}"`);
  });

  it('maps kind onto the native input type', () => {
    expect(
      renderInputSet({ fields: [{ label: 'Email', kind: 'email', required: true }] }),
    ).toContain('type="email"');
    expect(
      renderInputSet({ fields: [{ label: 'Mobile', kind: 'tel', required: false }] }),
    ).toContain('type="tel"');
    expect(
      renderInputSet({ fields: [{ label: 'Name', kind: 'text', required: true }] }),
    ).toContain('type="text"');
  });

  it('renders the bare required attribute (not just aria-required) when required is true', () => {
    const html = renderInputSet({ fields: [{ label: 'Postcode', kind: 'text', required: true }] });
    // (?<!aria-) excludes matching the "required" inside "aria-required", which the naive
    // /\brequired\b/ pattern also matches — "-" is a non-word character, so \b fires right
    // after it too. This checks for the bare HTML boolean attribute specifically.
    expect(html).toMatch(/(?<!aria-)\brequired\b/);
    expect(html).toContain('aria-required="true"');
  });

  it('omits the bare required attribute when required is false (aria-required="false" is still present)', () => {
    const html = renderInputSet({ fields: [{ label: 'Mobile', kind: 'tel', required: false }] });
    expect(html).not.toMatch(/(?<!aria-)\brequired\b/);
    expect(html).toContain('aria-required="false"');
  });

  it('renders both fields of the real check-availability instance, both carrying the bare required attribute', () => {
    const block = blocksNamed(BASE, 'input-set').find((b) =>
      (b.props as { fields: { label: string }[] }).fields.some((f) => f.label === 'Postcode'),
    );
    const html = renderInputSet(block!.props as unknown as InputSetProps);
    expect(html).toContain('Postcode');
    expect(html).toContain('House number or name');
    expect(html.match(/(?<!aria-)\brequired\b/g)).toHaveLength(2);
  });

  it('renders the real your-details instance with Mobile not required', () => {
    const block = blocksNamed(BASE, 'input-set').find((b) =>
      (b.props as { fields: { label: string }[] }).fields.some((f) => f.label === 'Mobile'),
    );
    const html = renderInputSet(block!.props as unknown as InputSetProps);
    expect(html).toContain('aria-required="false"');
  });

  it('escapes a hostile label so it cannot break out of the label element', () => {
    const html = renderInputSet({
      fields: [{ label: '<script>alert(1)</script>', kind: 'text', required: true }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('wraps the control in its own span for the rough-border overlay, without disturbing the label/id association, required, or aria-required', () => {
    // This is the thing this change could plausibly break: the wrapper sits between the
    // <label for> target and its own id, and between the control and the required markers.
    const html = renderInputSet({ fields: [{ label: 'Postcode', kind: 'text', required: true }] });
    expect(html).toContain('<span class="ds-field__control-wrap">');
    const idMatch = html.match(/id="([^"]+)"/);
    expect(idMatch).not.toBeNull();
    expect(html).toContain(`for="${idMatch![1]}"`);
    expect(html).toMatch(/(?<!aria-)\brequired\b/);
    expect(html).toContain('aria-required="true"');
  });
});

describe('sketchAdapter — status renderer', () => {
  function renderStatus(props: StatusProps): string {
    return sketchAdapter.components['status']!(props as unknown);
  }

  it('renders a distinct class, label, and the message for tone "pending"', () => {
    const html = renderStatus({ tone: 'pending', message: 'We will check this.' });
    expect(html).toContain('ds-status--pending');
    expect(html).toContain('Pending');
    expect(html).toContain('We will check this.');
  });

  it('renders a distinct class, label, and the message for tone "good"', () => {
    const html = renderStatus({ tone: 'good', message: 'Full Fibre is available.' });
    expect(html).toContain('ds-status--good');
    expect(html).toContain('Good');
    expect(html).toContain('Full Fibre is available.');
  });

  it('carries tone through a rough inline SVG mark, monochrome by construction (stroke=currentColor, fill=none)', () => {
    const pending = renderStatus({ tone: 'pending', message: 'x' });
    const good = renderStatus({ tone: 'good', message: 'x' });
    for (const html of [pending, good]) {
      expect(html).toContain('<svg');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('fill="none"');
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it('the two tones render different path data, so tone is not carried by colour alone', () => {
    const pending = renderStatus({ tone: 'pending', message: 'x' });
    const good = renderStatus({ tone: 'good', message: 'x' });
    const pendingPath = pending.match(/<path d="([^"]+)"/)?.[1];
    const goodPath = good.match(/<path d="([^"]+)"/)?.[1];
    expect(pendingPath).toBeDefined();
    expect(goodPath).toBeDefined();
    expect(pendingPath).not.toBe(goodPath);
  });

  it('the two tones render different viewBox values — sizing in styles.ts depends on this difference', () => {
    // Both SVGs carry the identical .ds-status__glyph-svg class, so a CSS rule cannot size them
    // differently by class alone; it can only key off the ancestor tone class. This pins the
    // other half of that: the viewBox really does differ, which is what makes a square box
    // wrong for pending (it would squash the hourglass back into a bowtie).
    const pending = renderStatus({ tone: 'pending', message: 'x' });
    const good = renderStatus({ tone: 'good', message: 'x' });
    const pendingViewBox = pending.match(/viewBox="([^"]+)"/)?.[1];
    const goodViewBox = good.match(/viewBox="([^"]+)"/)?.[1];
    expect(pendingViewBox).toBeDefined();
    expect(goodViewBox).toBeDefined();
    expect(pendingViewBox).not.toBe(goodViewBox);
  });

  it('no longer renders the tone as an emoji or a borrowed monochrome character', () => {
    const pending = renderStatus({ tone: 'pending', message: 'x' });
    const good = renderStatus({ tone: 'good', message: 'x' });
    expect(pending).not.toContain('⏳');
    expect(pending).not.toContain('⧖');
    expect(good).not.toContain('✓');
  });

  it('renders both real instances from the two reference journeys', () => {
    const [baseStatus] = blocksNamed(BASE, 'status');
    const [variantStatus] = blocksNamed(POSTCODE_FIRST, 'status');
    expect(renderStatus(baseStatus!.props as unknown as StatusProps)).toContain(
      'We will check this against the exchange',
    );
    expect(renderStatus(variantStatus!.props as unknown as StatusProps)).toContain(
      'Full Fibre is available',
    );
  });

  it('escapes a hostile message', () => {
    const html = renderStatus({ tone: 'good', message: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('sketchAdapter — option-list renderer', () => {
  function renderOptionList(props: OptionListProps): string {
    return sketchAdapter.components['option-list']!(props as unknown);
  }

  it('renders every option as a checkbox with its label and detail', () => {
    const html = renderOptionList({
      selection: 'many',
      options: [{ label: 'Whole-home wifi discs', detail: '£7 a month' }],
    });
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Whole-home wifi discs');
    expect(html).toContain('£7 a month');
  });

  it('associates each option label with its control', () => {
    const html = renderOptionList({
      selection: 'many',
      options: [{ label: 'Static IP address', detail: '£5 a month' }],
    });
    const idMatch = html.match(/id="([^"]+)"/);
    expect(idMatch).not.toBeNull();
    expect(html).toContain(`for="${idMatch![1]}"`);
  });

  it('renders the real add-extras instance shared by both journeys', () => {
    const [block] = blocksNamed(BASE, 'option-list');
    const html = renderOptionList(block!.props as unknown as OptionListProps);
    expect(html).toContain('Whole-home wifi discs');
    expect(html).toContain('Static IP address');
    expect(html).toContain('Engineer install');
  });

  it('escapes a hostile option label', () => {
    const html = renderOptionList({
      selection: 'many',
      options: [{ label: '<script>alert(1)</script>', detail: 'x' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a hostile option detail', () => {
    const html = renderOptionList({
      selection: 'many',
      options: [{ label: 'x', detail: '"><script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>');
  });

  it('wraps the checkbox in its own span for the rough-border overlay, without disturbing the label/id association', () => {
    const html = renderOptionList({
      selection: 'many',
      options: [{ label: 'Static IP address', detail: '£5 a month' }],
    });
    expect(html).toContain('<span class="ds-option__control-wrap">');
    const idMatch = html.match(/id="([^"]+)"/);
    expect(idMatch).not.toBeNull();
    expect(html).toContain(`for="${idMatch![1]}"`);
  });
});

describe('sketchAdapter — summary renderer', () => {
  function renderSummary(props: SummaryProps): string {
    return sketchAdapter.components['summary']!(props as unknown);
  }

  it("renders each row's label and value", () => {
    const html = renderSummary({
      rows: [
        { label: 'Package', value: 'Family — 67 Mb, £31 a month', editTarget: 'browse-packages' },
      ],
    });
    expect(html).toContain('Package');
    expect(html).toContain('Family — 67 Mb, £31 a month');
  });

  it("renders editTarget as an in-page anchor to that screen's section id", () => {
    const html = renderSummary({
      rows: [{ label: 'Address', value: '12 Example Street', editTarget: 'check-availability' }],
    });
    expect(html).toContain('href="#screen-check-availability"');
  });

  it('renders every row of the real base-journey confirm screen, each with its own edit link', () => {
    const [block] = blocksNamed(BASE, 'summary');
    const html = renderSummary(block!.props as unknown as SummaryProps);
    expect(html).toContain('href="#screen-browse-packages"');
    expect(html).toContain('href="#screen-check-availability"');
    expect(html).toContain('href="#screen-add-extras"');
    expect(html).toContain('href="#screen-your-details"');
  });

  it('escapes a hostile value so it cannot break out of its element', () => {
    const html = renderSummary({
      rows: [{ label: 'x', value: '<script>alert(1)</script>', editTarget: 'x' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the quote in a hostile editTarget so it cannot close the href attribute early and inject a real second attribute', () => {
    // The actual risk in an attribute-value context is the quote character, not angle
    // brackets: `<`/`>` inside a double-quoted attribute value stay inert text to the HTML
    // parser (it only looks for the next literal `"`), so a payload built from a raw
    // <script> tag proves nothing here — that is escapeHtml's job, already covered by the
    // label/value tests above. The payload that actually matters in this context is one
    // that supplies its own quote to close the attribute early and open a real one.
    const html = renderSummary({
      rows: [{ label: 'x', value: 'y', editTarget: '" onmouseover="alert(1)' }],
    });
    // The literal quote from editTarget must be escaped to &quot; — if it were not, the
    // href attribute would close early and onmouseover="..." would become a second, real,
    // browser-parsed HTML attribute rather than inert text inside href's own value.
    expect(html).toContain('&quot;');
    expect(html).not.toContain('href="#screen-" onmouseover="alert(1)"');
  });
});
