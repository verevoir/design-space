/**
 * The structural gate: checks coverage of an adapter against the port.
 *
 * Reports which port components are implemented by the adapter, which are
 * missing, and which rendered blocks fell back to a gap. Distinguishes three
 * finding kinds: a gap (adapter has no renderer), a defect (renderer threw),
 * and a schema finding (props failed the port schema before the adapter was
 * called — a data problem, not an adapter problem).
 */
export const PACKAGE_NAME = '@design-space/gate';

export { check } from './gate.js';
export type {
  GapFinding,
  DefectFinding,
  SchemaFinding,
  Finding,
  CoverageReport,
} from './gate.js';
export type { AdapterLike, Adapter } from '@design-space/adapter-contract';
export type { GapRecord } from '@design-space/render';
