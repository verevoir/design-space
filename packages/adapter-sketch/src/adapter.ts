import { type PromptProps } from '@design-space/port';
import { type Adapter, type ComponentRenderer } from '@design-space/adapter-contract';
import { SKETCH_CSS_CUSTOM_PROPERTIES } from './tokens.js';
import { SKETCH_STYLES } from './styles.js';

// The adapter's component renderer registry re-exports the shared contract's
// `Adapter` and `ComponentRenderer` types (ADR 0008) rather than declaring
// its own structural copy — this package used to be the only place `Adapter`
// was declared at all, which is what made the two later copies in `render`
// and `gate` invisible drift instead of an obvious duplication.

// ---------------------------------------------------------------------------
// Component implementations
// ---------------------------------------------------------------------------

function renderPrompt(props: PromptProps): string {
  const explainHtml = props.explain
    ? `<p class="ds-prompt__explain">${escapeHtml(props.explain)}</p>`
    : '';
  return `<div class="ds-prompt">
  <h1 class="ds-prompt__heading">${escapeHtml(props.heading)}</h1>${explainHtml ? `\n  ${explainHtml}` : ''}
</div>`;
}

const renderPromptComponent: ComponentRenderer<PromptProps> = renderPrompt;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const sketchAdapter: Adapter = {
  name: 'sketch',
  components: {
    prompt: (props: unknown) => renderPromptComponent(props as PromptProps),
  },
  styles: SKETCH_STYLES,
  tokens: SKETCH_CSS_CUSTOM_PROPERTIES,
};
