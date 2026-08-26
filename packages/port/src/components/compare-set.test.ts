import { describe, expect, it } from 'vitest';
import type { JourneyDocument } from '@design-space/journey-model';
import { CompareSetPropsSchema } from './compare-set.js';
import base from '../../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import postcodeFirst from '../../../../examples/journeys/broadband-switch.postcode-first.json' with { type: 'json' };

const BASE = base as unknown as JourneyDocument;
const POSTCODE_FIRST = postcodeFirst as unknown as JourneyDocument;

function compareSetInstances(journey: JourneyDocument): readonly unknown[] {
  return journey.screens
    .flatMap((screen) => screen.blocks)
    .filter((block) => block.component === 'compare-set')
    .map((block) => block.props);
}

describe('CompareSetPropsSchema', () => {
  it('accepts the compare-set instance in the base journey', () => {
    const instances = compareSetInstances(BASE);
    expect(instances).toHaveLength(1);
    expect(CompareSetPropsSchema.safeParse(instances[0]).success).toBe(true);
  });

  it('accepts the compare-set instance in the postcode-first variation', () => {
    const instances = compareSetInstances(POSTCODE_FIRST);
    expect(instances).toHaveLength(1);
    expect(CompareSetPropsSchema.safeParse(instances[0]).success).toBe(true);
  });

  it('the base journey instance leaves at least one item unmarked — emphasis really is optional, not just declared so', () => {
    const [props] = compareSetInstances(BASE) as [{ items: { emphasis?: boolean }[] }];
    expect(props.items.some((item) => item.emphasis === undefined)).toBe(true);
  });

  it('rejects an item whose values array does not match the attributes count', () => {
    const result = CompareSetPropsSchema.safeParse({
      attributes: ['Speed', 'Price'],
      items: [{ name: 'Only one value', values: ['67 Mb'] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects items that are not an array', () => {
    const result = CompareSetPropsSchema.safeParse({ attributes: ['Speed'], items: 'not-an-array' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty items array', () => {
    const result = CompareSetPropsSchema.safeParse({ attributes: ['Speed'], items: [] });
    expect(result.success).toBe(false);
  });
});
