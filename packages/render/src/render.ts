import { type JourneyDocument, type Screen, type Block, type Action } from '@design-space/journey-model';
import { getContract } from '@design-space/port';

/**
 * An adapter component map. Typed loosely so render is not bound to a specific
 * adapter package — any object with the right shape satisfies it.
 */
export interface AdapterLike {
  readonly name: string;
  readonly components: Readonly<Record<string, (props: unknown) => string>>;
}

/** A block that fell through because the adapter has no renderer for it. */
export interface GapRecord {
  readonly screenId: string;
  readonly component: string;
  /** Set when the adapter had a renderer but it threw. Carries the error message text. */
  readonly error?: string;
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

  try {
    const contract = getContract(block.component);
    const props = contract ? contract.propsSchema.parse(block.props) : block.props;
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
  border: 1px solid #ddd;
  border-radius: 6px;
}
.ds-screen + .ds-screen { border-top: none; }
.ds-screen__actions {
  margin-top: 2rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.ds-action {
  display: inline-block;
  padding: 0.5rem 1.25rem;
  border-radius: 4px;
  text-decoration: none;
  font-weight: 600;
  border: 2px solid currentColor;
  color: #1a6fb5;
}
.ds-action--primary { background: #1a6fb5; color: #fff; border-color: #1a6fb5; }
.ds-action--secondary { background: transparent; color: #1a6fb5; }
.ds-action--destructive { background: transparent; color: #c0392b; border-color: #c0392b; }
.ds-action--escape { background: transparent; color: #555; border-color: #aaa; }
/* Gap: visible box naming the missing component */
.ds-gap {
  border: 2px dashed #e74c3c;
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
/* prompt component */
.ds-prompt { margin-bottom: 1.5rem; }
.ds-prompt__heading { margin: 0 0 0.5rem; font-size: 1.5rem; }
.ds-prompt__explain { margin: 0; color: #444; }
`.trim();

function buildDocument(journey: JourneyDocument, adapter: AdapterLike, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(journey.title)}</title>
<style>
${PAGE_CSS}
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
 */
export function render(journey: JourneyDocument, adapter: AdapterLike): RenderResult {
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
