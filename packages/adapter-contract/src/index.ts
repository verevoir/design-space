/**
 * The adapter contract: the shape every design-system adapter registers
 * against, and the one seam `render`, `gate` and every adapter package import
 * instead of copying structurally (ADR 0008).
 *
 * Widened from `{ name, components }` to also carry:
 *   - `styles`  — a CSS rules string, written against `var(--ds-*)`, describing
 *                 that adapter's component appearance.
 *   - `tokens`  — the token set as structured data (name -> value), not an
 *                 opaque string, so a value can be looked up rather than
 *                 parsed out of CSS (needed by the gate's future resolution
 *                 and contrast checks, 3.3 / 4.1).
 *
 * Lives in its own package, deliberately not in `port` — port's own header
 * says nothing in it may know about rendering, and `styles` is rendering
 * (ADR 0008, "Why not port").
 */
export const PACKAGE_NAME = '@design-space/adapter-contract';

/** A component renderer: validated props in, an HTML string out. */
export type ComponentRenderer<T = unknown> = (props: T) => string;

/**
 * An adapter: everything `render` and `gate` need to compose and check one
 * design system's expression of the port.
 */
export interface Adapter {
  readonly name: string;
  readonly components: Readonly<Record<string, ComponentRenderer<unknown>>>;
  /**
   * CSS rules for this adapter's component appearance, written against
   * `var(--ds-*)` custom properties rather than literal values, so a
   * token-only variant (4.1) can change appearance without touching a rule.
   */
  readonly styles: string;
  /**
   * The token set as structured data: token name (without the leading `--`)
   * to its CSS value. Structured so a value can be read directly instead of
   * parsed out of `styles`.
   */
  readonly tokens: Readonly<Record<string, string>>;
}

/**
 * Alias kept so call sites can keep writing `AdapterLike` — the name in use
 * before ADR 0008 — without it being a second, independently-maintained
 * shape. It is a type alias, not a structural duplicate: change `Adapter`
 * and every `AdapterLike` use follows, because there is only one definition.
 */
export type AdapterLike = Adapter;

/**
 * Runtime guard: throws unless `adapter` actually carries `styles` (a
 * string) and `tokens` (a plain record) — the two fields ADR 0008 added.
 *
 * This exists because TypeScript's structural typing erases at runtime: a
 * caller holding an object built against the old `{ name, components }`
 * shape compiles against `Adapter` with no error if nothing checks the two
 * new fields, and the widening becomes silent no-op that reads like a fix
 * (ADR 0008's second rationale). `render()` and `gate.check()` both call
 * this first, so an incomplete adapter is rejected at the one place both
 * of them accept one, not left to whichever CSS rule happens to reference
 * the missing token.
 */
export function assertAdapter(adapter: Adapter, context: string): void {
  const name = typeof adapter?.name === 'string' ? adapter.name : String(adapter?.name);
  if (typeof adapter.styles !== 'string') {
    throw new TypeError(
      `${context}: adapter "${name}" must supply "styles" as a CSS rules string (ADR 0008); got ${typeof adapter.styles}.`,
    );
  }
  if (
    typeof adapter.tokens !== 'object' ||
    adapter.tokens === null ||
    Array.isArray(adapter.tokens)
  ) {
    throw new TypeError(
      `${context}: adapter "${name}" must supply "tokens" as a structured record (ADR 0008); got ${typeof adapter.tokens}.`,
    );
  }
}
