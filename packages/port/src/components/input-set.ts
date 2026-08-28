import { z } from 'zod';

/**
 * `input-set` — a set of labelled input fields.
 *
 * Induced jointly from both reference journeys (ADR 0001, story 2.1):
 * `check-availability` (2 fields, both required) and `your-details` (3
 * fields, one optional). Every instance in both journeys supplies
 * `required` explicitly, on every field, so it is modelled as required —
 * not optional — since no instance ever omitted it.
 *
 * `kind` is a closed set: only `'text'`, `'email'` and `'tel'` appear across
 * both journeys. A future journey needing another input kind widens this
 * enum — a MINOR bump, per version.ts — rather than the schema admitting an
 * unobserved kind now (ADR 0001: induced from real journeys, never designed
 * a priori).
 */
const InputFieldSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(['text', 'email', 'tel']),
  required: z.boolean(),
});

export const InputSetPropsSchema = z.object({
  fields: z.array(InputFieldSchema).min(1),
});

export type InputSetProps = z.infer<typeof InputSetPropsSchema>;
