import { type JourneyDocument, type Screen, type Block, type Action } from '@design-space/journey-model';
import { getContract } from '@design-space/port';
import { type Adapter, assertAdapter } from '@design-space/adapter-contract';

/**
 * An adapter component map, plus presentation (ADR 0008). Kept as a type
 * alias of the shared `Adapter` contract rather than a structural copy — the
 * package used to declare its own `{ name, components }` interface here,
 * which is exactly the kind of duplicate that let the contract widen without
 * either `render` or `gate` noticing. There is now one definition, imported.
 */
export type AdapterLike = Adapter;

/** A block that fell through because the adapter has no renderer for it. */
export interface GapRecord {
  readonly screenId: string;
  readonly component: string;
  /**
   * Set when the adapter had a renderer but it threw. Carries the error message text.
   * Distinct from `schemaError` — in this case the renderer was called and failed.
   */
  readonly error?: string;
  /**
   * Set when the block's props failed the component's port schema.
   * The adapter was never called — this is a data problem, not an adapter defect.
   */
  readonly schemaError?: string;
}

/** The full output of a render call. */
export interface RenderResult {
  /** The standalone HTML document. */
  readonly html: string;
  /** Every block whose component the adapter did not implement. */
  readonly gaps: readonly GapRecord[];
}

// ---------------------------------------------------------------------------
// Gap rendering
// ---------------------------------------------------------------------------

function renderGap(component: string): string {
  return `<div class="ds-gap" aria-label="Gap: ${escapeAttr(component)}" role="note">
  <span class="ds-gap__label">GAP</span>
  <span class="ds-gap__component">${escapeHtml(component)}</span>
</div>`;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function renderBlock(
  block: Block,
  adapter: AdapterLike,
  screenId: string,
  gaps: GapRecord[],
): string {
  const renderer = adapter.components[block.component];
  if (renderer === undefined) {
    gaps.push({ screenId, component: block.component });
    return renderGap(block.component);
  }

  const contract = getContract(block.component);
  if (contract !== undefined) {
    let props: unknown;
    try {
      props = contract.propsSchema.parse(block.props);
    } catch (err) {
      // The block's props are invalid against the port schema — the adapter was
      // never called, so this is not a renderer defect. Record it distinctly.
      const message = err instanceof Error ? err.message : String(err);
      gaps.push({ screenId, component: block.component, schemaError: message });
      return renderGap(block.component);
    }
    try {
      return renderer(props);
    } catch (err) {
      // A defect: the renderer threw. Treat as a gap so the document stays whole,
      // but mark it differently so gate can distinguish gap from defect.
      // The raw error message is recorded on the gap record for gate to inspect,
      // but is NOT embedded in the HTML — internal detail must not reach the page.
      const message = err instanceof Error ? err.message : String(err);
      gaps.push({ screenId, component: block.component, error: message });
      return renderGap(block.component);
    }
  }

  // No port contract for this component — the adapter has a renderer but the
  // component is not in the port. Pass raw props through without schema
  // validation. This is the intentional escape hatch for adapter components
  // that are not yet in the port contract.
  try {
    return renderer(block.props);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    gaps.push({ screenId, component: block.component, error: message });
    return renderGap(block.component);
  }
}

// ---------------------------------------------------------------------------
// Action / navigation rendering
// ---------------------------------------------------------------------------

function renderAction(action: Action, allScreenIds: ReadonlySet<string>): string {
  const href = action.target !== null && allScreenIds.has(action.target)
    ? `#screen-${escapeAttr(action.target)}`
    : '#';
  return `<a class="ds-action ds-action--${escapeAttr(action.weight)}" href="${href}">${escapeHtml(action.label)}</a>`;
}

// ---------------------------------------------------------------------------
// Screen rendering
// ---------------------------------------------------------------------------

function renderScreen(
  screen: Screen,
  adapter: AdapterLike,
  allScreenIds: ReadonlySet<string>,
  gaps: GapRecord[],
): string {
  const blocks = screen.blocks
    .map((b) => renderBlock(b, adapter, screen.id, gaps))
    .join('\n');
  const actions = screen.actions
    .map((a) => renderAction(a, allScreenIds))
    .join('\n');
  const actionsSection = actions
    ? `<nav class="ds-screen__actions" aria-label="Screen actions">\n${actions}\n</nav>`
    : '';

  return `<section class="ds-screen" id="screen-${escapeAttr(screen.id)}" aria-label="${escapeAttr(screen.purpose)}">
${blocks}
${actionsSection}
</section>`;
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

/**
 * Document chrome only: reset, layout of a screen and its actions, and the
 * gap element's visual shape. Component appearance (`.ds-prompt*`,
 * `.ds-action--*`) used to live here too — ADR 0008 moved it into the
 * adapter's own `styles`, because `render` owning it meant every adapter
 * rendered identically and a token swap could change nothing on screen.
 *
 * `.ds-screen` and `.ds-gap` stay here — they are document-owned layout, not
 * a port component's appearance — but their border *colour* is read through
 * `var(--ds-*)` with a literal fallback, so an adapter can still recolour
 * them via tokens without owning the rule.
 */
const PAGE_CSS = `
:root { box-sizing: border-box; }
*, *::before, *::after { box-sizing: inherit; }
body {
  font-family: sans-serif;
  margin: 0;
  padding: 2rem;
  background: #fff;
  color: #111;
}
.ds-screen {
  max-width: 36rem;
  margin: 0 auto 4rem;
  padding: 2rem;
  border: 1px solid var(--ds-border-color, #ddd);
  border-radius: 6px;
}
.ds-screen + .ds-screen { border-top: none; }
.ds-screen__actions {
  margin-top: 2rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
/* Gap: visible box naming the missing component */
.ds-gap {
  border: 2px dashed var(--ds-gap-border, #e74c3c);
  border-radius: 4px;
  padding: 1rem;
  margin: 0.75rem 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #fff9f9;
  color: #c0392b;
}
.ds-gap__label {
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: #e74c3c;
  color: #fff;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  flex-shrink: 0;
}
.ds-gap__component {
  font-family: monospace;
  font-size: 0.9rem;
}
`.trim();

/**
 * Wraps an adapter's structured tokens as a `:root { --name: value; }`
 * block, so a token-only variant reaches the page as real custom properties
 * (ADR 0008) rather than staying inert data nothing reads.
 */
function tokensBlock(tokens: Readonly<Record<string, string>>): string {
  const entries = Object.entries(tokens)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');
  return `:root {\n${entries}\n}`;
}

function buildDocument(journey: JourneyDocument, adapter: AdapterLike, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(journey.title)}</title>
<style>
${PAGE_CSS}
${tokensBlock(adapter.tokens)}
${adapter.styles}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(journey.title)}</h1>
  <p>Adapter: ${escapeHtml(adapter.name)}</p>
</header>
<main>
${body}
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a journey document with the given adapter into a standalone HTML document.
 *
 * Blocks whose component the adapter does not implement produce a visible,
 * labelled gap element in the output and are recorded in `result.gaps`. The
 * document is always complete — a missing component is never a crash.
 *
 * Rejects an adapter that does not carry `styles` and `tokens` (ADR 0008) —
 * see `assertAdapter`.
 */
export function render(journey: JourneyDocument, adapter: AdapterLike): RenderResult {
  assertAdapter(adapter, 'render()');
  const gaps: GapRecord[] = [];
  const allScreenIds = new Set(journey.screens.map((s) => s.id));

  const screenHtml = journey.screens
    .map((s) => renderScreen(s, adapter, allScreenIds, gaps))
    .join('\n');

  const html = buildDocument(journey, adapter, screenHtml);
  return { html, gaps };
}

// ---------------------------------------------------------------------------
// Utilities (private)
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
