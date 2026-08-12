import { PORT_COMPONENTS, type ComponentName } from '@design-space/port';
import type { JourneyDocument } from '@design-space/journey-model';
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

export type Finding = GapFinding | DefectFinding;

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
 * Check adapter coverage against the port and render the journey to collect
 * gap findings.
 *
 * Gaps (missing renderer) are distinguished from defects (renderer threw).
 * A gap is a finding about the adapter's completeness; a defect is a bug.
 */
export function check(
  adapter: AdapterLike,
  journey: JourneyDocument,
  renderGaps: readonly GapRecord[],
): CoverageReport {
  const portNames = Object.keys(PORT_COMPONENTS) as ComponentName[];

  const implemented = portNames.filter(
    (name) => Object.prototype.hasOwnProperty.call(adapter.components, name),
  );
  const missing = portNames.filter(
    (name) => !Object.prototype.hasOwnProperty.call(adapter.components, name),
  );

  // Collect all unique (component, screenId) combinations from journey blocks
  // to classify each gap record as a gap or defect.
  const defectComponents = new Set<string>();

  // A defect is a component that the adapter HAS but that rendered badly.
  // We detect this by checking whether the component appears in the adapter
  // yet also appears in the gap list.
  const findings: Finding[] = renderGaps.map((gap) => {
    if (Object.prototype.hasOwnProperty.call(adapter.components, gap.component)) {
      // Renderer existed but threw — that is a defect.
      const errorMatch = gap.component.match(/\[render error: (.+)\]$/);
      defectComponents.add(gap.component);
      return {
        kind: 'defect' as const,
        component: gap.component,
        screenId: gap.screenId,
        error: errorMatch ? (errorMatch[1] ?? 'unknown error') : 'unknown error',
      };
    }
    return {
      kind: 'gap' as const,
      component: gap.component,
      screenId: gap.screenId,
    };
  });

  // Suppress unused-var warning: journey is accepted for future use (block
  // enumeration once render is not called separately).
  void journey;

  return { implemented, missing, findings };
}
