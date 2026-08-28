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
 * against tokens that both resolve — but at least one resolved value is not
 * a colour this check can parse (not hex, not an opaque `rgb()`/`rgba()`
 * with alpha 1). Named CSS colours (`chartreuse`), gradients, and partial
 * alpha are all reported here rather than guessed at: an unmeasurable pair
 * must never appear as a contrast pass or fail.
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
// Regex-based — a deliberate heuristic, not a CSS parser: it looks for
// `selector { … }` blocks and, within each, a `color` declaration and a
// `background`/`background-color` declaration, each naming a `var(--token)`.
// Comments, `!important`, shorthand `background: var(--x) url(...)`, and
// deeply nested at-rules are not specially handled — anything this scan
// cannot confidently read is left unmeasured rather than guessed at, per the
// same rule colour parsing follows below.
// ---------------------------------------------------------------------------

const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const VAR_REFERENCE_PATTERN = /var\(\s*--([a-zA-Z][a-zA-Z0-9-]*)\s*(?:,[^)]*)?\)/g;
const COLOR_DECLARATION_PATTERN = /^color\s*:\s*var\(\s*--([a-zA-Z][a-zA-Z0-9-]*)/;
const BACKGROUND_DECLARATION_PATTERN =
  /^background(?:-color)?\s*:\s*var\(\s*--([a-zA-Z][a-zA-Z0-9-]*)/;

interface ContrastPair {
  readonly selector: string;
  readonly foregroundToken: string;
  readonly backgroundToken: string;
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
    let foregroundToken: string | undefined;
    let backgroundToken: string | undefined;
    for (const rawDecl of body.split(';')) {
      const decl = rawDecl.trim();
      const colorMatch = COLOR_DECLARATION_PATTERN.exec(decl);
      if (colorMatch) {
        foregroundToken = colorMatch[1];
        continue;
      }
      const bgMatch = BACKGROUND_DECLARATION_PATTERN.exec(decl);
      if (bgMatch) {
        backgroundToken = bgMatch[1];
      }
    }
    if (foregroundToken !== undefined && backgroundToken !== undefined) {
      pairs.push({ selector, foregroundToken, backgroundToken });
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
    const foregroundValue = adapter.tokens[pair.foregroundToken]!;
    const backgroundValue = adapter.tokens[pair.backgroundToken]!;
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
