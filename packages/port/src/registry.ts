import { type ZodTypeAny } from 'zod';
import { PromptPropsSchema } from './components/prompt.js';

/**
 * The set of component names defined in this version of the port.
 * Wave 2.1 will extend this list after inducing the full vocabulary from journeys.
 */
export type ComponentName = 'prompt';

/** A component contract: the name and Zod schema for its props. */
export interface ComponentContract {
  readonly name: ComponentName;
  readonly propsSchema: ZodTypeAny;
}

/** All defined component contracts, keyed by name. */
export const PORT_COMPONENTS: Readonly<Record<ComponentName, ComponentContract>> = {
  prompt: { name: 'prompt', propsSchema: PromptPropsSchema },
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
