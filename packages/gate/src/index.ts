/**
 * The structural gate: checks an adapter against the port and reports four
 * counted facts (story 3.3) — never agent testimony:
 *
 *   - coverage         — which port components the adapter implements (`implemented`/`missing`)
 *   - escape hatches   — adapter components with no port entry at all
 *   - token resolution — `var(--x)` references in `styles` with no matching `tokens` entry
 *   - contrast         — WCAG 2.1 luminance-ratio pairs found in `styles`, measured against
 *                         a bar that defaults to WCAG 2.1 AA normal text (4.5:1) and is
 *                         overridable per call
 *
 * Also classifies a prior `render()` call's gap records into gap / defect /
 * schema findings, distinguishing a finding about a design system (gap) from
 * a finding about the adapter's own code (defect) from a data problem
 * (schema).
 */
export const PACKAGE_NAME = '@design-space/gate';

export { check, WCAG21_AA_NORMAL_TEXT_CONTRAST } from './gate.js';
export type {
  GapFinding,
  DefectFinding,
  SchemaFinding,
  Finding,
  EscapeHatchFinding,
  UnresolvedTokenFinding,
  ContrastFinding,
  UnmeasurableContrastFinding,
  CheckOptions,
  CoverageReport,
} from './gate.js';
export type { AdapterLike, Adapter } from '@design-space/adapter-contract';
export type { GapRecord } from '@design-space/render';
