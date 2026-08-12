import { PORT_COMPONENTS, type ComponentName } from '@design-space/port';
import type { AdapterLike, GapRecord } from './adapter-like.js';

// ---------------------------------------------------------------------------
// Types
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

/** Full coverage report for one (adapter, journey) pair. */
export interface CoverageReport {
  /** Components in the port that the adapter has implemented. */
  readonly implemented: readonly ComponentName[];
  /** Components in the port that the adapter has NOT implemented. */
  readonly missing: readonly ComponentName[];
  /** Gap and defect findings from rendering. */
  readonly findings: readonly Finding[];
}

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------

/**
 * Check adapter coverage against the port and classify gap findings from a
 * prior render() call.
 *
 * Gaps (missing renderer) are distinguished from defects (renderer threw).
 * A gap is a finding about the adapter's completeness; a defect is a bug.
 */
export function check(
  adapter: AdapterLike,
  renderGaps: readonly GapRecord[],
): CoverageReport {
  const portNames = Object.keys(PORT_COMPONENTS) as ComponentName[];

  const implemented = portNames.filter(
    (name) => Object.prototype.hasOwnProperty.call(adapter.components, name),
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

  return { implemented, missing, findings };
}
