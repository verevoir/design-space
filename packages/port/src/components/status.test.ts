import { describe, expect, it } from 'vitest';
import type { JourneyDocument } from '@design-space/journey-model';
import { StatusPropsSchema } from './status.js';
import base from '../../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import postcodeFirst from '../../../../examples/journeys/broadband-switch.postcode-first.json' with { type: 'json' };

const BASE = base as unknown as JourneyDocument;
const POSTCODE_FIRST = postcodeFirst as unknown as JourneyDocument;

function statusInstances(journey: JourneyDocument): readonly { tone: string; message: string }[] {
  return journey.screens
    .flatMap((screen) => screen.blocks)
    .filter((block) => block.component === 'status')
    .map((block) => block.props as { tone: string; message: string });
}

describe('StatusPropsSchema', () => {
  // `status` turns out to appear exactly once in EACH journey, not only the
  // postcode-first variant as the variation's own narrative might suggest —
  // confirming that directly here, since the story asked this to be checked
  // rather than assumed.
  it('appears exactly once in the base journey, tone "pending"', () => {
    const instances = statusInstances(BASE);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.tone).toBe('pending');
  });

  it('appears exactly once in the postcode-first variation, tone "good"', () => {
    const instances = statusInstances(POSTCODE_FIRST);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.tone).toBe('good');
  });

  it('accepts both observed instances', () => {
    for (const props of [...statusInstances(BASE), ...statusInstances(POSTCODE_FIRST)]) {
      expect(StatusPropsSchema.safeParse(props).success).toBe(true);
    }
  });

  it('rejects a tone outside the two observed values — no journey exercises an "unavailable" tone', () => {
    const result = StatusPropsSchema.safeParse({ tone: 'bad', message: 'Not available here.' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing message', () => {
    const result = StatusPropsSchema.safeParse({ tone: 'good' });
    expect(result.success).toBe(false);
  });
});
