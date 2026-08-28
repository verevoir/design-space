import { PORT_COMPONENTS, type ComponentName } from '@design-space/port';
import { type AdapterLike, assertAdapter } from '@design-space/adapter-contract';
import type { GapRecord } from '@design-space/render';

// ---------------------------------------------------------------------------
// Types — render-derived findings (require an actual render() call)
// ---------------------------------------------------------------------------

/**
 * A gap: the adapter has no renderer for a component that appears in the
 * journey. This is a finding about the adapter, not a defect in the code.
 */
export interface GapFinding {
  readonly kind: 'gap';
  readonly component: string;
  readonly screenId: string;
}

/**
 * A defect: a renderer was called but threw an error. This is a finding about
 * the adapter's implementation, not just a missing component.
 */
export interface DefectFinding {
  readonly kind: 'defect';
  readonly component: string;
  readonly screenId: string;
  readonly error: string;
}

/**
 * A schema finding: the adapter HAS a renderer but the block's props failed
 * the component's port schema, so the renderer was never called. This is a
 * data problem — neither a missing adapter nor an adapter defect.
 */
export interface SchemaFinding {
  readonly kind: 'schema';
  readonly component: string;
  readonly screenId: string;
  readonly schemaError: string;
}

export type Finding = GapFinding | DefectFinding | SchemaFinding;

// ---------------------------------------------------------------------------
// Types — static findings (computed from the adapter alone; story 3.3)
// ---------------------------------------------------------------------------

/**
 * An escape hatch: the adapter implements a component whose name has no
 * entry in the port at all. `render.ts` documents this as the intentional
 * fallback for adapter components "not yet in the port contract" — their
 * props pass through unvalidated. That is a real, structural fact about the
 * adapter (it would take this path whenever the component is used),
 * computable without a render call — so it is reported here as its own
 * kind, distinct from `missing` (a port component the adapter lacks) and
 * distinct from `implemented` (a port component genuinely covered): an
 * escape-hatch component must never be counted as coverage.
 */
export interface EscapeHatchFinding {
  readonly kind: 'escapeHatch';
  readonly component: string;
}

/**
 * A token reference with no definition: `adapter.styles` reads
 * `var(--name)` for some name that has no matching entry in `adapter.tokens`.
 * Reported once per distinct token name referenced anywhere in `styles`,
 * regardless of how many rules reference it.
 */
export interface UnresolvedTokenFinding {
  readonly kind: 'unresolvedToken';
  readonly token: string;
}

/**
 * A measured contrast pair: one CSS rule in `adapter.styles` declares both
 * `color: var(--fg)` and `background`/`background-color: var(--bg)`, and
 * both tokens resolved to a colour this check can parse. `ratio` is the
 * WCAG 2.1 contrast ratio; `passes` is `ratio >= bar`.
 */
export interface ContrastFinding {
  readonly kind: 'contrast';
  readonly selector: string;
  readonly foregroundToken: string;
  readonly backgroundToken: string;
  readonly ratio: number;
  readonly bar: number;
  readonly passes: boolean;
}

/**
 * A contrast pair was found — a rule declares both `color` and `background`
 * against tokens that both resolve — but the pair cannot be confidently
 * measured, for one of three reasons: at least one resolved token value is
 * not a colour this check can parse (not hex, not an opaque `rgb()`/`rgba()`
 * with alpha 1 — named CSS colours like `chartreuse`, gradients, and partial
 * alpha all land here); at least one of the two declarations is not a
 * single, standalone colour reference — e.g. `background: var(--bg)
 * url(hero.png) no-repeat` (extra content trailing the token) or
 * `background: linear-gradient(var(--bg), red)` (the token embedded inside
 * another function rather than leading the value) — where the flat token
 * colour is only one layer of what actually renders, so measuring it alone
 * could report a ratio that does not describe what a reader would see; or
 * the declaration that wins
 * the cascade for a slot (the last one in source order, unless an earlier
 * one carries `!important`) is a plain literal with no token reference at
 * all — e.g. `background-color: var(--bg); background: white;`, where
 * `white` overrides the token and measuring `--bg`'s own value would report
 * a confident number for a colour that no longer renders. Either way: an
 * unmeasurable pair must never appear as a contrast pass or fail.
 */
export interface UnmeasurableContrastFinding {
  readonly kind: 'unmeasurableContrast';
  readonly selector: string;
  readonly foregroundToken: string;
  readonly backgroundToken: string;
  readonly foregroundValue: string;
  readonly backgroundValue: string;
}

/** WCAG 2.1 AA, normal text. The default contrast bar — override via `CheckOptions.contrastBar`. */
export const WCAG21_AA_NORMAL_TEXT_CONTRAST = 4.5;

export interface CheckOptions {
  /**
   * The contrast ratio a measured pair must meet or exceed to pass.
   * Defaults to `WCAG21_AA_NORMAL_TEXT_CONTRAST` (4.5) — WCAG 2.1 AA,
   * normal text. A parameter with a default, not a constant buried in the
   * algorithm, so "the declared bar" (backlog.md, story 3.3) is a value
   * callers can see and change, not prose describing an aspiration.
   */
  readonly contrastBar?: number;
}

/** Full coverage report for one (adapter, journey) pair. */
export interface CoverageReport {
  /** Components in the port that the adapter has implemented. */
  readonly implemented: readonly ComponentName[];
  /** Components in the port that the adapter has NOT implemented. */
  readonly missing: readonly ComponentName[];
  /** Gap, defect and schema findings — require an actual render() call. */
  readonly findings: readonly Finding[];
  /** Adapter components with no port entry — the escape-hatch fallback path. */
  readonly escapeHatches: readonly EscapeHatchFinding[];
  /** Token names `adapter.styles` references that `adapter.tokens` has no entry for. */
  readonly unresolvedTokens: readonly UnresolvedTokenFinding[];
  /** Foreground/background pairs that resolved and were measured — pass or fail. */
  readonly contrast: readonly ContrastFinding[];
  /** Foreground/background pairs found but not measurable — never a pass or a fail. */
  readonly unmeasurableContrast: readonly UnmeasurableContrastFinding[];
}

// ---------------------------------------------------------------------------
// Static scanning helpers
//
// Regex-based — a deliberate heuristic, not a CSS parser: it looks for the
// innermost `selector { … }` blocks (the pattern does not track brace
// nesting, so an at-rule wrapping a rule is not specially rejected — the
// inner rule still gets found and parsed the same as an unwrapped one) and,
// within each, EVERY `color` declaration and every `background`/
// `background-color` declaration (there can be more than one of each in a
// single rule — a later one can override an earlier one), each naming a
// `var(--token[, fallback])` reference.
//
// Which declaration actually WINS for a slot is resolved by the two cascade
// rules this scan can determine from source text alone within one rule: a
// declaration carrying `!important` beats a normal one regardless of which
// comes first, and among declarations of equal importance the LAST one in
// source order wins — this is why `background-color: var(--bg); background:
// white;` must resolve to `white`, not to `--bg`'s value, and why an
// earlier `!important` still beats a later declaration that lacks one. This
// is not a full CSS cascade engine — it does not model shorthand resets
// beyond treating `background` and `background-color` as one combined slot
// (already true of the regex below). A `var(--token)` reference is
// recognised wherever it appears in a declaration's value, not only when it
// leads it — so a token embedded inside another function, e.g. `background:
// linear-gradient(var(--bg), red)`, is still found and the declaration
// correctly reported as carrying more than a single colour reference
// (unmeasurable), rather than silently vanishing from every report because
// no branch recognised it at all. This scan still never computes an actual
// rendered colour out of a gradient, `url()`, or any other function — only
// whether a token reference is present, which is enough to classify the
// pair honestly. Anything past what these rules resolve is left unmeasured
// rather than guessed at, exactly like every other unparseable case here.
//
// A declaration counts as MEASURABLE only if its entire value is exactly one
// such reference, optionally followed by `!important` — nothing else. A
// winning declaration that names a token but also carries other content
// (e.g. `background: var(--bg) url(hero.png) no-repeat`, where the flat
// colour is only one layer of what actually renders) is recognised as
// carrying more than a single colour reference. A winning declaration that
// carries no token reference at all — a plain literal or keyword — is still
// reported, identified by the most recently referenced token for that slot
// (so a reader can see which token got overridden), but with the ACTUAL
// winning text as its value, never the overridden token's own resolved
// value; if no declaration for the slot ever referenced a token at all,
// there is nothing to identify the pair by and it is not counted. Either
// way the pair it belongs to is reported as `unmeasurableContrast`, never
// guessed at as a pass or fail. A rule where a declaration is not found at
// all (a CSS comment sitting where a colour declaration was expected, an
// unrecognised property) is simply not counted as a pair at all — silence,
// not a wrong measurement, matching the existing rule that a lone `color`
// with no `background` counts nowhere.
// ---------------------------------------------------------------------------

const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const VAR_REFERENCE_PATTERN = /var\(\s*--([a-zA-Z][a-zA-Z0-9-]*)\s*(?:,[^)]*)?\)/g;
const COLOR_DECLARATION_PATTERN = /^color\s*:\s*(.+)$/;
const BACKGROUND_DECLARATION_PATTERN = /^background(?:-color)?\s*:\s*(.+)$/;

/**
 * A declaration's value is measurable only if it is exactly one
 * `var(--token[, fallback])` reference, optionally trailed by `!important`
 * — nothing else. Anything else that contains a `var(--token)` reference
 * ANYWHERE in the value — not only leading it, e.g. a token embedded inside
 * another function such as `linear-gradient(var(--bg), red)` — is reported
 * as that token, but flagged impure: the declaration carries more than a
 * single colour reference, so it must not be silently measured as if the
 * token's own value were the whole story, and it must not silently vanish
 * from every report either. A value with no `var()` reference at all is
 * not a candidate — returns `null`.
 */
const SINGLE_VAR_REFERENCE_VALUE_PATTERN =
  /^var\(\s*--([a-zA-Z][a-zA-Z0-9-]*)\s*(?:,[^)]*)?\)\s*(?:!important)?$/;
// Unanchored deliberately: a token reference can appear anywhere in a
// declaration's value, not only leading it — see parseColourDeclarationValue.
const EMBEDDED_VAR_REFERENCE_PATTERN = /var\(\s*--([a-zA-Z][a-zA-Z0-9-]*)/;

interface ParsedDeclarationValue {
  readonly token: string;
  readonly pure: boolean;
  /** The raw, trimmed declaration value — used for reporting when `pure` is false. */
  readonly rawValue: string;
}

function parseColourDeclarationValue(rawValue: string): ParsedDeclarationValue | null {
  const value = rawValue.trim();
  const pureMatch = SINGLE_VAR_REFERENCE_VALUE_PATTERN.exec(value);
  if (pureMatch) {
    return { token: pureMatch[1]!, pure: true, rawValue: value };
  }
  const looseMatch = EMBEDDED_VAR_REFERENCE_PATTERN.exec(value);
  if (looseMatch) {
    return { token: looseMatch[1]!, pure: false, rawValue: value };
  }
  return null;
}

/** One declaration seen for a property slot (`color`, or `background`/`background-color` combined), in source order. */
interface DeclarationOccurrence {
  readonly rawValue: string;
  readonly important: boolean;
}

// The literal `!important` this codebase's own PURE-match pattern above
// already recognises — matched the same way here so cascade priority and
// value parsing never disagree about what counts as "important".
const IMPORTANT_SUFFIX_PATTERN = /!important\s*$/;

function hasImportantSuffix(rawValue: string): boolean {
  return IMPORTANT_SUFFIX_PATTERN.test(rawValue.trim());
}

/**
 * Which declaration for one property slot actually takes effect: the last
 * `!important` one if any exist (regardless of what comes after it), else
 * the last normal one. Importance is checked before source order, matching
 * the real CSS cascade rule for two declarations of the same specificity.
 *
 * Requires `occurrences` to be non-empty. Its only caller, `resolveSlot`,
 * already checks this before calling — given a non-empty input, every
 * iteration of the loop below assigns either `lastImportant` or
 * `lastNormal`, so by the time the loop ends at least one is always set:
 * the `??` below can never fall through to `undefined`. That is true for
 * every non-empty input, not just the typical one, which is why the return
 * type carries no `| undefined` — an `undefined` return here would be
 * unreachable and untestable dead code, exactly the shape a review round
 * caught when this function used to advertise that possibility.
 */
function resolveWinningDeclaration(
  occurrences: readonly DeclarationOccurrence[],
): DeclarationOccurrence {
  let lastImportant: DeclarationOccurrence | undefined;
  let lastNormal: DeclarationOccurrence | undefined;
  for (const occurrence of occurrences) {
    if (occurrence.important) {
      lastImportant = occurrence;
    } else {
      lastNormal = occurrence;
    }
  }
  // Non-null by the precondition above (occurrences non-empty) — not by
  // TypeScript's own inference, since `occurrences` is a plain array type
  // rather than a non-empty tuple. This documents an invariant the caller
  // holds, rather than re-deriving it in a way that would itself need an
  // unreachable else-branch.
  return (lastImportant ?? lastNormal) as DeclarationOccurrence;
}

/**
 * The most recently declared token-bearing value for a slot, in source
 * order, independent of importance — used only to LABEL a pair when the
 * winning declaration itself carries no token (see `resolveSlot`). Never
 * used as the reported value: that is always the winning declaration's own
 * text, so an overridden token's colour can never be silently substituted
 * for what would actually render.
 */
function lastTokenBearingDeclaration(
  occurrences: readonly DeclarationOccurrence[],
): ParsedDeclarationValue | undefined {
  let last: ParsedDeclarationValue | undefined;
  for (const occurrence of occurrences) {
    const parsed = parseColourDeclarationValue(occurrence.rawValue);
    if (parsed !== null) {
      last = parsed;
    }
  }
  return last;
}

/**
 * Resolves one property slot (every `color` declaration in a rule, or
 * every `background`/`background-color` declaration treated as one
 * combined slot) to the value that should be measured, honouring cascade
 * order — see the module comment above `RULE_PATTERN` for the two rules
 * this does and does not model. Returns `undefined` when the slot has no
 * declaration at all, or when the winning declaration has no token and no
 * earlier declaration in the slot ever named one either — both cases mean
 * there is nothing to report a pair by, so the slot is silently absent
 * rather than guessed at.
 */
function resolveSlot(
  occurrences: readonly DeclarationOccurrence[],
): ParsedDeclarationValue | undefined {
  if (occurrences.length === 0) {
    return undefined;
  }
  const winning = resolveWinningDeclaration(occurrences);
  const winningParsed = parseColourDeclarationValue(winning.rawValue);
  if (winningParsed !== null) {
    return winningParsed;
  }
  // The winning declaration carries no var() reference at all — a plain
  // literal or keyword overrode an earlier token. Identify the slot by the
  // most recently referenced token, but report the winning declaration's
  // OWN text as the value: the overridden token's resolved colour must
  // never be reported as if it were still what renders.
  const lastToken = lastTokenBearingDeclaration(occurrences);
  if (lastToken === undefined) {
    return undefined;
  }
  return { token: lastToken.token, pure: false, rawValue: winning.rawValue.trim() };
}

interface ContrastPair {
  readonly selector: string;
  readonly foregroundToken: string;
  readonly backgroundToken: string;
  readonly foregroundPure: boolean;
  readonly backgroundPure: boolean;
  readonly foregroundRawValue: string;
  readonly backgroundRawValue: string;
}

function findReferencedTokens(styles: string): Set<string> {
  const names = new Set<string>();
  for (const m of styles.matchAll(VAR_REFERENCE_PATTERN)) {
    names.add(m[1]!);
  }
  return names;
}

function findContrastPairs(styles: string): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  for (const ruleMatch of styles.matchAll(RULE_PATTERN)) {
    const selector = ruleMatch[1]!.trim();
    const body = ruleMatch[2]!;
    const colorOccurrences: DeclarationOccurrence[] = [];
    const backgroundOccurrences: DeclarationOccurrence[] = [];
    for (const rawDecl of body.split(';')) {
      const decl = rawDecl.trim();
      const colorMatch = COLOR_DECLARATION_PATTERN.exec(decl);
      if (colorMatch) {
        const rawValue = colorMatch[1]!;
        colorOccurrences.push({ rawValue, important: hasImportantSuffix(rawValue) });
        continue;
      }
      const bgMatch = BACKGROUND_DECLARATION_PATTERN.exec(decl);
      if (bgMatch) {
        const rawValue = bgMatch[1]!;
        backgroundOccurrences.push({ rawValue, important: hasImportantSuffix(rawValue) });
      }
    }
    const foreground = resolveSlot(colorOccurrences);
    const background = resolveSlot(backgroundOccurrences);
    if (foreground !== undefined && background !== undefined) {
      pairs.push({
        selector,
        foregroundToken: foreground.token,
        backgroundToken: background.token,
        foregroundPure: foreground.pure,
        backgroundPure: background.pure,
        foregroundRawValue: foreground.rawValue,
        backgroundRawValue: background.rawValue,
      });
    }
  }
  return pairs;
}

interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function isByte(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 255;
}

/**
 * Parses a colour this check can measure: 3- or 6-digit hex, or an opaque
 * `rgb()`/`rgba()` (alpha exactly 1 — anything else would need alpha
 * compositing against a real page background this check does not have).
 * A named CSS colour (`chartreuse`), a gradient, a partial-alpha `rgba()`,
 * or anything else returns `null` — reported as unmeasurable, never guessed.
 */
function parseColour(value: string): RGB | null {
  const trimmed = value.trim();

  const hex6 = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (hex6) {
    const hex = hex6[1]!;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (hex3) {
    const hex = hex3[1]!;
    return {
      r: parseInt(hex[0]! + hex[0], 16),
      g: parseInt(hex[1]! + hex[1], 16),
      b: parseInt(hex[2]! + hex[2], 16),
    };
  }

  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(trimmed);
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return isByte(r) && isByte(g) && isByte(b) ? { r, g, b } : null;
  }

  const rgba =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(1|1\.0+|0*1)\s*\)$/.exec(trimmed);
  if (rgba) {
    const [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    return isByte(r) && isByte(g) && isByte(b) ? { r, g, b } : null;
  }

  return null;
}

/** WCAG 2.1 relative luminance (§1.4.3 / Appendix G). */
function relativeLuminance({ r, g, b }: RGB): number {
  const linearize = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.1 contrast ratio between two colours: (L1 + 0.05) / (L2 + 0.05), lighter over darker. */
function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------

/**
 * Check an adapter against the port and report four counted facts (story
 * 3.3): coverage (`implemented`/`missing`), escape hatches, unresolved
 * tokens, and contrast — plus the existing gap/defect/schema classification
 * of a prior `render()` call's gap records. Nothing here is agent testimony:
 * every field is derived directly from `adapter` (and, for `findings`,
 * `renderGaps`) by counting or measuring, never by asserting.
 *
 * `renderGaps` is optional — coverage, escape hatches, token resolution and
 * contrast are all static properties of `adapter` alone and need no render
 * call; pass a real render's gap records to also get `findings`.
 *
 * Rejects an adapter that does not carry `styles` and `tokens` (ADR 0008) —
 * see `assertAdapter`.
 */
export function check(
  adapter: AdapterLike,
  renderGaps: readonly GapRecord[] = [],
  options: CheckOptions = {},
): CoverageReport {
  assertAdapter(adapter, 'gate.check()');
  const contrastBar = options.contrastBar ?? WCAG21_AA_NORMAL_TEXT_CONTRAST;

  const portNames = Object.keys(PORT_COMPONENTS) as ComponentName[];
  const portNameSet = new Set<string>(portNames);

  const implemented = portNames.filter((name) =>
    Object.prototype.hasOwnProperty.call(adapter.components, name),
  );
  const missing = portNames.filter(
    (name) => !Object.prototype.hasOwnProperty.call(adapter.components, name),
  );

  // Classify each gap record into one of three kinds:
  //   schema  — adapter has a renderer but props failed the port schema (adapter never called)
  //   defect  — adapter has a renderer, props were valid, but renderer threw
  //   gap     — adapter has no renderer at all
  const findings: Finding[] = renderGaps.map((gap) => {
    if (gap.schemaError !== undefined) {
      return {
        kind: 'schema' as const,
        component: gap.component,
        screenId: gap.screenId,
        schemaError: gap.schemaError,
      };
    }
    if (Object.prototype.hasOwnProperty.call(adapter.components, gap.component)) {
      // Renderer existed but threw — that is a defect.
      // The error text is carried on the GapRecord.error field set by render().
      return {
        kind: 'defect' as const,
        component: gap.component,
        screenId: gap.screenId,
        error: gap.error ?? 'unknown error',
      };
    }
    return {
      kind: 'gap' as const,
      component: gap.component,
      screenId: gap.screenId,
    };
  });

  // Escape hatches: adapter component names with no port entry at all —
  // static, and must never also count toward `implemented`.
  const escapeHatches: EscapeHatchFinding[] = Object.keys(adapter.components)
    .filter((name) => !portNameSet.has(name))
    .map((component) => ({ kind: 'escapeHatch' as const, component }));

  // Unresolved tokens: every var(--x) in styles with no matching adapter.tokens entry.
  const referencedTokens = findReferencedTokens(adapter.styles);
  const unresolvedTokens: UnresolvedTokenFinding[] = [...referencedTokens]
    .filter((name) => !Object.prototype.hasOwnProperty.call(adapter.tokens, name))
    .map((token) => ({ kind: 'unresolvedToken' as const, token }));
  const unresolvedTokenNames = new Set(unresolvedTokens.map((f) => f.token));

  // Contrast: color/background pairs co-occurring in one rule, both tokens resolved.
  const contrast: ContrastFinding[] = [];
  const unmeasurableContrast: UnmeasurableContrastFinding[] = [];
  for (const pair of findContrastPairs(adapter.styles)) {
    // An unresolved token is already reported above as a resolution problem —
    // it must never also surface as a contrast result.
    if (
      unresolvedTokenNames.has(pair.foregroundToken) ||
      unresolvedTokenNames.has(pair.backgroundToken)
    ) {
      continue;
    }
    // A side is reported by its resolved token value when its declaration was
    // a single, standalone reference; otherwise by the raw declaration value,
    // so the reason it is unmeasurable (extra content beyond the token) is
    // visible rather than hidden behind what looks like an ordinary colour.
    const foregroundValue = pair.foregroundPure
      ? adapter.tokens[pair.foregroundToken]!
      : pair.foregroundRawValue;
    const backgroundValue = pair.backgroundPure
      ? adapter.tokens[pair.backgroundToken]!
      : pair.backgroundRawValue;
    if (!pair.foregroundPure || !pair.backgroundPure) {
      unmeasurableContrast.push({
        kind: 'unmeasurableContrast',
        selector: pair.selector,
        foregroundToken: pair.foregroundToken,
        backgroundToken: pair.backgroundToken,
        foregroundValue,
        backgroundValue,
      });
      continue;
    }
    const fg = parseColour(foregroundValue);
    const bg = parseColour(backgroundValue);
    if (fg === null || bg === null) {
      unmeasurableContrast.push({
        kind: 'unmeasurableContrast',
        selector: pair.selector,
        foregroundToken: pair.foregroundToken,
        backgroundToken: pair.backgroundToken,
        foregroundValue,
        backgroundValue,
      });
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    contrast.push({
      kind: 'contrast',
      selector: pair.selector,
      foregroundToken: pair.foregroundToken,
      backgroundToken: pair.backgroundToken,
      ratio,
      bar: contrastBar,
      passes: ratio >= contrastBar,
    });
  }

  return {
    implemented,
    missing,
    findings,
    escapeHatches,
    unresolvedTokens,
    contrast,
    unmeasurableContrast,
  };
}
