import { z } from 'zod';

/**
 * `summary` — a review list of labelled rows, each pointing back at the
 * screen where that value was set.
 *
 * Induced jointly from both reference journeys' `confirm` screens: 4 rows
 * each, 8 instances total, every row in every instance carrying
 * `editTarget`. The two journeys order the rows differently (address first
 * in the postcode-first variation, package first in the base journey) —
 * that is the real disagreement between them, and it is data, not schema,
 * so row order is not encoded here. `editTarget` names a screen id
 * elsewhere in the same journey document; validating that cross-reference
 * would need the whole journey document, not just this block's own props,
 * so it is left as a plain `string` here rather than reached for from a
 * single-component schema.
 */
const SummaryRowSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  editTarget: z.string().min(1),
});

export const SummaryPropsSchema = z.object({
  rows: z.array(SummaryRowSchema).min(1),
});

export type SummaryProps = z.infer<typeof SummaryPropsSchema>;
