import { z } from 'zod';

/**
 * `option-list` — a set of selectable options, each with a label and a
 * short detail string.
 *
 * The `add-extras` screen carries a structurally identical instance in both
 * reference journeys — same three options, same `'many'` selection mode,
 * unchanged by the postcode-first variation — so this is really one data
 * point observed twice, not two independent instances. `selection` is
 * modelled as a closed enum of the single value actually seen; a real
 * system almost certainly also needs a single-select mode, but inventing
 * `'one'` now, without a journey that uses it, would be designing the port
 * a priori, which ADR 0001 rejects. `detail` is required because every
 * option in the one instance observed carries it — noted as this
 * component's thinnest evidence alongside `status`.
 */
const OptionSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1),
});

export const OptionListPropsSchema = z.object({
  selection: z.enum(['many']),
  options: z.array(OptionSchema).min(1),
});

export type OptionListProps = z.infer<typeof OptionListPropsSchema>;
