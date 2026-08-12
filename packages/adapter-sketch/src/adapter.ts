import { type PromptProps } from '@design-space/port';

/**
 * A component renderer takes validated props and returns an HTML string.
 * The adapter is not given the journey document — it only sees the props for
 * one block at a time (architecture §3: adapters must not know which journey).
 */
export type ComponentRenderer<T = Record<string, unknown>> = (props: T) => string;

/**
 * An adapter: a map from component name to its renderer.
 * The renderer is typed as `(props: unknown) => string` at the registry level;
 * each implementation casts to its own prop type after validation by the port.
 */
export interface Adapter {
  readonly name: string;
  readonly components: Readonly<Record<string, ComponentRenderer<unknown>>>;
}

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
    prompt: (props) => renderPrompt(props as PromptProps),
  },
};
