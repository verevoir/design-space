import { z } from 'zod';

/**
 * `compare-set` — a table comparing named items across a shared set of
 * attributes, with at most one item marked for emphasis.
 *
 * Induced jointly from both reference journeys' `browse-packages` screens
 * (ADR 0001, story 2.1). Both journeys agree on the shape; the only real
 * variation observed is which items carry `emphasis` — the base journey's
 * three-item instance leaves two of its three items unmarked, so `emphasis`
 * is modelled as optional rather than required, admitting the no-emphasis
 * case actually seen rather than forcing every item to carry it.
 *
 * Every item's `values` array has exactly one entry per `attributes` entry
 * in every instance observed in both journeys (3 attributes, 3 values, with
 * no exception) — encoded as a refinement rather than left uncounted, since
 * the invariant held without exception across every instance seen.
 */
const CompareSetItemSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string()),
  emphasis: z.boolean().optional(),
});

export const CompareSetPropsSchema = z
  .object({
    attributes: z.array(z.string().min(1)).min(1),
    items: z.array(CompareSetItemSchema).min(1),
  })
  .refine(
    (props) => props.items.every((item) => item.values.length === props.attributes.length),
    { message: 'every item.values must have exactly one entry per attributes entry' },
  );

export type CompareSetProps = z.infer<typeof CompareSetPropsSchema>;
