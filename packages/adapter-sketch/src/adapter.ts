import {
  type PromptProps,
  type CompareSetProps,
  type InputSetProps,
  type StatusProps,
  type OptionListProps,
  type SummaryProps,
} from '@design-space/port';
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

/**
 * `compare-set` renders as a plain HTML table — `<th scope="col">` per
 * attribute, `<th scope="row">` per item name — so the comparison stays a
 * real table to assistive tech, not a div grid that only looks like one.
 *
 * `emphasis` is expressed sketchily rather than as a polished highlight: no
 * fill colour, no badge, no border-colour swap. A single hand-drawn mark
 * (`✦`, in the annotation typeface) sits next to the item name, and that
 * row's borders turn dashed — two channels, neither of them a colour fill,
 * so the row does not read as a finished "featured plan" card. A
 * screen-reader-only "Recommended: " prefix carries the same meaning the
 * mark carries visually, since `aria-hidden` alone would drop it for
 * anyone not seeing the glyph.
 */
function renderCompareSet(props: CompareSetProps): string {
  const headerCells = props.attributes
    .map((attribute) => `<th scope="col">${escapeHtml(attribute)}</th>`)
    .join('');
  const rows = props.items
    .map((item) => {
      const emphasisMark = item.emphasis
        ? `<span class="ds-compare-set__emphasis-mark" aria-hidden="true">✦</span><span class="ds-visually-hidden">Recommended: </span>`
        : '';
      const rowClass = item.emphasis ? ' class="ds-compare-set__item--emphasis"' : '';
      const cells = item.values.map((value) => `<td>${escapeHtml(value)}</td>`).join('');
      return `<tr${rowClass}><th scope="row">${emphasisMark}${escapeHtml(item.name)}</th>${cells}</tr>`;
    })
    .join('\n    ');
  return `<table class="ds-compare-set">
  <thead><tr><th scope="col"></th>${headerCells}</tr></thead>
  <tbody>
    ${rows}
  </tbody>
</table>`;
}

/**
 * `input-set` renders real semantic form controls, not a styled lookalike:
 * a `<label for>` genuinely associated with its `<input id>`, the
 * `required` attribute actually present when the field is required (not
 * only implied by an asterisk), and `kind` mapped straight onto the input's
 * native `type`. Sketch fidelity here is about visual weight — a
 * hand-drawn label and a plain-bordered control — not about dropping the
 * semantics a real form needs.
 *
 * The control's id is derived from the field's own label (slugified). This
 * is deterministic and sufficient for both reference journeys, where no two
 * fields share a label within one block; a renderer receives only this
 * block's own props, never the journey document or a sibling block
 * (architecture §3: an adapter must not know which journey it renders), so
 * there is no document-wide registry available here to guarantee
 * uniqueness beyond that.
 */
function renderInputSet(props: InputSetProps): string {
  const fields = props.fields
    .map((field) => {
      const id = `ds-field-${slugify(field.label)}`;
      const requiredMark = field.required
        ? `<span class="ds-field__required" aria-hidden="true"> *</span>`
        : '';
      const requiredAttrs = field.required
        ? ' required aria-required="true"'
        : ' aria-required="false"';
      return `<div class="ds-field">
    <label class="ds-field__label" for="${escapeAttr(id)}">${escapeHtml(field.label)}${requiredMark}</label>
    <input class="ds-field__control" type="${escapeAttr(field.kind)}" id="${escapeAttr(id)}" name="${escapeAttr(id)}"${requiredAttrs}>
  </div>`;
    })
    .join('\n  ');
  return `<div class="ds-input-set">
  ${fields}
</div>`;
}

/**
 * `status` carries its tone through more than colour: a distinct glyph
 * (`⏳` pending, `✓` good), a short text label naming the tone in words,
 * and a border style (dashed for pending, solid for good) — three
 * independent channels, so a reader who cannot perceive colour still gets
 * the tone from the glyph or the label alone. `role="status"` makes this
 * an ARIA live region, appropriate for a message that can change as a
 * check completes.
 */
function renderStatus(props: StatusProps): string {
  const glyph = props.tone === 'good' ? '✓' : '⏳';
  const label = props.tone === 'good' ? 'Good' : 'Pending';
  return `<div class="ds-status ds-status--${escapeAttr(props.tone)}" role="status">
  <span class="ds-status__glyph" aria-hidden="true">${glyph}</span>
  <span class="ds-status__label">${escapeHtml(label)}</span>
  <span class="ds-status__message">${escapeHtml(props.message)}</span>
</div>`;
}

/**
 * `option-list` renders each option as a real `<label>` wrapping a
 * `<input type="checkbox">`, with an explicit `for`/`id` pair alongside the
 * wrapping association for maximum assistive-tech compatibility. The
 * port's `selection` enum admits only `'many'` today (ADR 0001: not
 * widened ahead of a journey that actually needs single-select), so
 * checkboxes are the only control this renderer needs to produce.
 */
function renderOptionList(props: OptionListProps): string {
  const options = props.options
    .map((option, index) => {
      const id = `ds-option-${slugify(option.label)}-${index}`;
      return `<label class="ds-option" for="${escapeAttr(id)}">
    <input class="ds-option__control" type="checkbox" id="${escapeAttr(id)}" name="${escapeAttr(id)}">
    <span class="ds-option__text">
      <span class="ds-option__label">${escapeHtml(option.label)}</span>
      <span class="ds-option__detail">${escapeHtml(option.detail)}</span>
    </span>
  </label>`;
    })
    .join('\n  ');
  return `<div class="ds-option-list" role="group">
  ${options}
</div>`;
}

/**
 * `summary`'s `editTarget` becomes a real in-page anchor: `render.ts`
 * assembles every screen as a `<section id="screen-<id>">` in one
 * document, so `#screen-<editTarget>` is not a placeholder — it genuinely
 * jumps to that screen's section today, with no additional route needed.
 * It is not validated against the journey's actual screen ids here — this
 * renderer receives only this block's own props, not the journey document
 * (architecture §3) — so an `editTarget` naming a screen that does not
 * exist produces a dead anchor rather than a render-time error, the same
 * trade `render.ts`'s own `renderAction` makes for an action's `target`.
 */
function renderSummary(props: SummaryProps): string {
  const rows = props.rows
    .map(
      (row) => `<div class="ds-summary__row">
    <span class="ds-summary__label">${escapeHtml(row.label)}</span>
    <span class="ds-summary__value">${escapeHtml(row.value)}</span>
    <a class="ds-summary__edit" href="#screen-${escapeAttr(row.editTarget)}">Edit</a>
  </div>`,
    )
    .join('\n  ');
  return `<div class="ds-summary">
  ${rows}
</div>`;
}

const renderPromptComponent: ComponentRenderer<PromptProps> = renderPrompt;
const renderCompareSetComponent: ComponentRenderer<CompareSetProps> = renderCompareSet;
const renderInputSetComponent: ComponentRenderer<InputSetProps> = renderInputSet;
const renderStatusComponent: ComponentRenderer<StatusProps> = renderStatus;
const renderOptionListComponent: ComponentRenderer<OptionListProps> = renderOptionList;
const renderSummaryComponent: ComponentRenderer<SummaryProps> = renderSummary;

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

/**
 * Escapes text for use inside a double-quoted HTML attribute value,
 * additionally escaping single quotes — which `escapeHtml` does not —
 * mirroring `render.ts`'s own private `escapeAttr`. That one cannot be
 * imported: it is not part of `@design-space/render`'s public entry point,
 * so this package carries its own copy rather than reaching past the
 * boundary.
 */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turns a label into a lowercase, hyphenated id fragment. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const sketchAdapter: Adapter = {
  name: 'sketch',
  components: {
    prompt: (props: unknown) => renderPromptComponent(props as PromptProps),
    'compare-set': (props: unknown) => renderCompareSetComponent(props as CompareSetProps),
    'input-set': (props: unknown) => renderInputSetComponent(props as InputSetProps),
    status: (props: unknown) => renderStatusComponent(props as StatusProps),
    'option-list': (props: unknown) => renderOptionListComponent(props as OptionListProps),
    summary: (props: unknown) => renderSummaryComponent(props as SummaryProps),
  },
  styles: SKETCH_STYLES,
  tokens: SKETCH_CSS_CUSTOM_PROPERTIES,
};
