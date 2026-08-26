import { z } from 'zod';

/**
 * `status` — a single-line status message with a tone.
 *
 * Appears exactly once in EACH reference journey, not only the
 * postcode-first variant as its narrative might suggest: the base
 * journey's `check-availability` screen carries tone `'pending'` ("We will
 * check this against the exchange before you confirm"), and the
 * postcode-first variant's `browse-packages` screen carries tone `'good'`
 * ("Full Fibre is available at 12 Example Street"). Two instances total,
 * one per journey — thinner evidence than the other induced components
 * here, and the enum below claims only what was actually observed. A tone
 * for the unavailable case (`'bad'`, or similar) is plausible for a real
 * system but is not induced here, because no journey exercises it —
 * widening the enum belongs to whichever journey first needs it (ADR 0001).
 */
export const StatusPropsSchema = z.object({
  tone: z.enum(['pending', 'good']),
  message: z.string().min(1),
});

export type StatusProps = z.infer<typeof StatusPropsSchema>;
