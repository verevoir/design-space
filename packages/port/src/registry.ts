import { type ZodTypeAny } from 'zod';
import { PromptPropsSchema } from './components/prompt.js';
import { CompareSetPropsSchema } from './components/compare-set.js';
import { InputSetPropsSchema } from './components/input-set.js';
import { StatusPropsSchema } from './components/status.js';
import { OptionListPropsSchema } from './components/option-list.js';
import { SummaryPropsSchema } from './components/summary.js';

/**
 * The set of component names defined in this version of the port.
 * Induced jointly from both reference journeys in wave 2.1 (ADR 0001) — `prompt`
 * proved the chain in wave 2S.1; the remaining five are the full vocabulary both
 * journeys' blocks actually use.
 */
export type ComponentName =
  | 'prompt'
  | 'compare-set'
  | 'input-set'
  | 'status'
  | 'option-list'
  | 'summary';

/** A component contract: the name and Zod schema for its props. */
export interface ComponentContract {
  readonly name: ComponentName;
  readonly propsSchema: ZodTypeAny;
}

/** All defined component contracts, keyed by name. */
export const PORT_COMPONENTS: Readonly<Record<ComponentName, ComponentContract>> = {
  prompt: { name: 'prompt', propsSchema: PromptPropsSchema },
  'compare-set': { name: 'compare-set', propsSchema: CompareSetPropsSchema },
  'input-set': { name: 'input-set', propsSchema: InputSetPropsSchema },
  status: { name: 'status', propsSchema: StatusPropsSchema },
  'option-list': { name: 'option-list', propsSchema: OptionListPropsSchema },
  summary: { name: 'summary', propsSchema: SummaryPropsSchema },
};

/**
 * Returns the contract for a named component, or undefined if the name is not
 * in the port. Callers use this to validate block props before rendering.
 */
export function getContract(name: string): ComponentContract | undefined {
  return Object.prototype.hasOwnProperty.call(PORT_COMPONENTS, name)
    ? PORT_COMPONENTS[name as ComponentName]
    : undefined;
}
