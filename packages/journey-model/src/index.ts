/**
 * The journey model: the semantic, design-system-free description of a journey.
 *
 * Single source of truth for:
 * - The Zod schema (JourneyDocumentSchema) — the shape validator
 * - The TypeScript types derived from it via z.infer
 * - The validate() function that enforces both shape and structural rules
 *
 * Nothing in this package may know about rendering, adapters, token sets or
 * any design system — see AGENTS.md and architecture §3.
 *
 * A JSON Schema artefact is derived from JourneyDocumentSchema at build time
 * and emitted to dist/journey-document.schema.json for discovery by tooling
 * that cannot consume TypeScript directly.
 */

export {
  ActionWeightSchema,
  BlockSchema,
  ActionSchema,
  ScreenSchema,
  JourneyDocumentSchema,
  type ActionWeight,
  type Block,
  type Action,
  type Screen,
  type JourneyDocument,
} from './schema.js';

export { validateJourney, type ValidationError, type ValidationResult } from './validate.js';

/** Package identity — kept for the boundary test that was wired in wave 0. */
export const PACKAGE_NAME = '@design-space/journey-model';
