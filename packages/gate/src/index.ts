/**
 * The structural gate: checks coverage of an adapter against the port.
 *
 * Reports which port components are implemented by the adapter, which are
 * missing, and which rendered blocks fell back to a gap. Distinguishes a gap
 * (a finding about adapter completeness) from a defect (a renderer crash).
 */
export const PACKAGE_NAME = '@design-space/gate';

export { check } from './gate.js';
export type {
  GapFinding,
  DefectFinding,
  Finding,
  CoverageReport,
} from './gate.js';
export type { AdapterLike, GapRecord } from './adapter-like.js';
