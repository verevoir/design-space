import { describe, expect, it } from 'vitest';
import type { JourneyDocument } from '@design-space/journey-model';
import { OptionListPropsSchema } from './option-list.js';
import base from '../../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import postcodeFirst from '../../../../examples/journeys/broadband-switch.postcode-first.json' with { type: 'json' };

const BASE = base as unknown as JourneyDocument;
const POSTCODE_FIRST = postcodeFirst as unknown as JourneyDocument;

function optionListInstances(journey: JourneyDocument): readonly unknown[] {
  return journey.screens
    .flatMap((screen) => screen.blocks)
    .filter((block) => block.component === 'option-list')
    .map((block) => block.props);
}

describe('OptionListPropsSchema', () => {
  it('accepts the add-extras instance in the base journey', () => {
    const instances = optionListInstances(BASE);
    expect(instances).toHaveLength(1);
    expect(OptionListPropsSchema.safeParse(instances[0]).success).toBe(true);
  });

  it('accepts the add-extras instance in the postcode-first variation, structurally identical to the base', () => {
    const instances = optionListInstances(POSTCODE_FIRST);
    expect(instances).toHaveLength(1);
    expect(OptionListPropsSchema.safeParse(instances[0]).success).toBe(true);
    // Both journeys leave add-extras unchanged by the variation — this is one
    // data point observed twice, not two independent ones (see the schema's
    // own doc comment on why `selection` claims only 'many').
    expect(instances[0]).toEqual(optionListInstances(BASE)[0]);
  });

  it('rejects a selection mode other than the single value observed ("many")', () => {
    const result = OptionListPropsSchema.safeParse({
      selection: 'one',
      options: [{ label: 'X', detail: 'Y' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an option missing detail', () => {
    const result = OptionListPropsSchema.safeParse({
      selection: 'many',
      options: [{ label: 'X' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty options array', () => {
    const result = OptionListPropsSchema.safeParse({ selection: 'many', options: [] });
    expect(result.success).toBe(false);
  });
});
