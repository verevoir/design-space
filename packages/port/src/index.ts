/**
 * The component port: the induced component vocabulary.
 *
 * Story 2S.1 defines ONE component — `prompt` — as a thin slice to prove the chain.
 * Wave 2.1 will induce the full vocabulary from the reference journeys.
 *
 * Nothing in this package may know about rendering or any specific adapter.
 */

export const PACKAGE_NAME = '@design-space/port';

export { PORT_VERSION } from './version.js';
export { PromptPropsSchema, type PromptProps } from './components/prompt.js';
export {
  type ComponentName,
  type ComponentContract,
  PORT_COMPONENTS,
  getContract,
} from './registry.js';
