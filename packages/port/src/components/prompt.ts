import { z } from 'zod';

/**
 * `prompt` — the screen-level heading and optional explanatory copy.
 *
 * The simplest component the reference journey uses; the first one proved
 * through the full chain in story 2S.1.
 */
export const PromptPropsSchema = z.object({
  heading: z.string().min(1),
  explain: z.string().optional(),
});

export type PromptProps = z.infer<typeof PromptPropsSchema>;
