import { z } from 'zod';

/**
 * Closed set of action weights — the only values a journey document may use.
 * Every adapter must handle all four; the port's size is multiplied by every
 * design system, so the set is deliberately small.
 */
export const ActionWeightSchema = z.enum([
  'primary',
  'secondary',
  'destructive',
  'escape',
]);

/** A block is one rendered component with its props. Props are intentionally
 *  open (record<string, unknown>) — the port induces the component vocabulary
 *  in wave 2; the schema owns only the structural envelope here.
 */
export const BlockSchema = z.object({
  component: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
});

/**
 * An action leads to another screen in this journey (target is the screen id)
 * or leaves the journey entirely (target is null).
 */
export const ActionSchema = z.object({
  label: z.string().min(1),
  weight: ActionWeightSchema,
  target: z.string().min(1).nullable(),
});

/**
 * A single screen in the journey.
 */
export const ScreenSchema = z.object({
  id: z.string().min(1),
  purpose: z.string().min(1),
  blocks: z.array(BlockSchema),
  actions: z.array(ActionSchema),
  annotations: z.array(z.string()),
});

/**
 * The top-level journey document.
 *
 * `variationOf` and `variationBecause` are optional — they are present only
 * when this document is a variation of another journey (e.g. the
 * postcode-first broadband-switch). See ADR 0003.
 *
 * A journey document must NOT name a design system — see architecture §3 and
 * AGENTS.md. Nothing in this package may import from any adapter, renderer or
 * token set.
 */
export const JourneyDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().min(1),
  variationOf: z.string().min(1).optional(),
  variationBecause: z.string().min(1).optional(),
  entry: z.string().min(1),
  screens: z.array(ScreenSchema).min(1),
});

/** TypeScript types derived from the schema — the single source of truth. */
export type ActionWeight = z.infer<typeof ActionWeightSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Screen = z.infer<typeof ScreenSchema>;
export type JourneyDocument = z.infer<typeof JourneyDocumentSchema>;
