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
 * Thrown when an adapter's `styles` or `tokens` *content* — not its shape —
 * would corrupt the document `render`'s `<style>` block is built from. Kept
 * distinct from the `TypeError`s above: "you forgot a field" is a developer
 * mistake against a known shape, "what you supplied would break out of the
 * block" is a rejection of untrusted input at the boundary ADR 0008 opens
 * for a phase-3 externally-published adapter, and a caller may reasonably
 * want to handle those two differently.
 */
export class AdapterContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterContentError';
  }
}

/**
 * The one real escape vector for `styles`: HTML's raw-text parsing rule ends
 * a `<style>` element the instant it sees this literal sequence, regardless
 * of what CSS otherwise legitimately contains — comments, quoted `content`,
 * `@media` blocks are all fine and stay unrestricted. Case-insensitive
 * because HTML tag matching is.
 */
const STYLE_CLOSE_PATTERN = /<\/style/i;

/** Token names follow the `ds-*` convention already in use throughout. */
const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Token values are interpolated as `--name: value;` inside a `:root { }`
 * block — a stricter context than `styles`: `}` closes the block early,
 * `;` opens a sibling declaration, and `<` still eventually reaches
 * `</style`. Tokens were never meant to hold arbitrary CSS — they are meant
 * to be looked up as data (ADR 0008's contrast-check rationale) — so this is
 * an allowlist, not a denylist: colours, lengths, keywords, quoted font
 * stacks, and calc() with all four arithmetic operators.
 */
const TOKEN_VALUE_PATTERN = /^[a-zA-Z0-9#%.,'"+*/\s()-]+$/;

/**
 * `+`, `-`, `*` and `/` are all admitted above for calc() — leaving one
 * arithmetic operator unsupported next to its three siblings is the kind of
 * asymmetry that reads as a bug. But a slash next to an asterisk can also
 * open a CSS comment, which would swallow every declaration that follows
 * until the comment is closed — including the adapter's own `styles` block,
 * concatenated right after — so that specific two-character sequence is
 * checked for and rejected separately, rather than solved by removing the
 * operator. (Written out to avoid the sequence closing this very comment:
 * slash-star and star-slash.)
 */
const COMMENT_SEQUENCE_PATTERN = /\/\*|\*\//;

/**
 * Runtime guard: throws unless `adapter` actually carries `styles` (a
 * string) and `tokens` (a plain record) — the two fields ADR 0008 added —
 * and, beyond shape, that their *content* cannot break out of the `<style>`
 * block or the `:root { }` rule `render` builds from them.
 *
 * This exists because TypeScript's structural typing erases at runtime: a
 * caller holding an object built against the old `{ name, components }`
 * shape compiles against `Adapter` with no error if nothing checks the two
 * new fields, and the widening becomes silent no-op that reads like a fix
 * (ADR 0008's second rationale). `render()` and `gate.check()` both call
 * this first, so an incomplete or unsafe adapter is rejected at the one
 * place both of them accept one, not left to whichever CSS rule happens to
 * reference the missing token — and not left to every future caller
 * (including phase-3 externally-published adapters, ADR 0008) to remember
 * to escape on their own.
 *
 * An adapter that is entirely absent (`null`/`undefined`) is rejected as a
 * distinct failure from one that is present but incomplete: the former
 * reads as a wiring problem — nothing resolved to an adapter object — the
 * latter as an implementation gap in an adapter that does exist. A phase-3
 * caller integrating an external adapter will want to tell those apart, so
 * this guard runs first and throws its own message rather than falling
 * through to a property access on `null`/`undefined`, which would throw an
 * engine `TypeError` with no context at all — the crash this fixes.
 */
export function assertAdapter(adapter: Adapter, context: string): void {
  if (adapter === null || typeof adapter === 'undefined') {
    throw new TypeError(
      `${context}: no adapter was provided (got ${adapter === null ? 'null' : 'undefined'}) — this looks like a wiring problem (nothing resolved to an adapter), not an adapter that is present but incomplete.`,
    );
  }
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

  if (STYLE_CLOSE_PATTERN.test(adapter.styles)) {
    throw new AdapterContentError(
      `${context}: adapter "${name}"'s "styles" contains "</style" — this would end the document's <style> block early, letting whatever follows run as arbitrary markup.`,
    );
  }

  for (const [tokenName, tokenValue] of Object.entries(adapter.tokens)) {
    if (!TOKEN_NAME_PATTERN.test(tokenName)) {
      throw new AdapterContentError(
        `${context}: adapter "${name}"'s token name "${tokenName}" is not a valid custom-property name (expected lowercase letters, digits, hyphens — e.g. "ds-accent").`,
      );
    }
    if (!TOKEN_VALUE_PATTERN.test(tokenValue) || COMMENT_SEQUENCE_PATTERN.test(tokenValue)) {
      throw new AdapterContentError(
        `${context}: adapter "${name}"'s token "${tokenName}" has a value that is not a plain CSS value (letters, digits, #%.,'"+*/-, spaces, parentheses; no "/*" or "*/") — got ${JSON.stringify(tokenValue)}.`,
      );
    }
  }
}
