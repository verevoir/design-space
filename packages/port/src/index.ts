/**
 * The component port: the induced component vocabulary.
 *
 * Story 2S.1 defined ONE component — `prompt` — as a thin slice to prove the chain.
 * Wave 2.1 induces the full vocabulary jointly from both reference journeys (ADR 0001):
 * `prompt` plus `compare-set`, `input-set`, `status`, `option-list` and `summary`.
 *
 * Nothing in this package may know about rendering or any specific adapter.
 */

export const PACKAGE_NAME = '@design-space/port';

export { PORT_VERSION } from './version.js';
export { PromptPropsSchema, type PromptProps } from './components/prompt.js';
export { CompareSetPropsSchema, type CompareSetProps } from './components/compare-set.js';
export { InputSetPropsSchema, type InputSetProps } from './components/input-set.js';
export { StatusPropsSchema, type StatusProps } from './components/status.js';
export { OptionListPropsSchema, type OptionListProps } from './components/option-list.js';
export { SummaryPropsSchema, type SummaryProps } from './components/summary.js';
export {
  type ComponentName,
  type ComponentContract,
  PORT_COMPONENTS,
  getContract,
} from './registry.js';
