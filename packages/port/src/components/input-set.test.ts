import { describe, expect, it } from 'vitest';
import type { JourneyDocument } from '@design-space/journey-model';
import { InputSetPropsSchema } from './input-set.js';
import base from '../../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import postcodeFirst from '../../../../examples/journeys/broadband-switch.postcode-first.json' with { type: 'json' };

const BASE = base as unknown as JourneyDocument;
const POSTCODE_FIRST = postcodeFirst as unknown as JourneyDocument;

function inputSetInstances(journey: JourneyDocument): readonly unknown[] {
  return journey.screens
    .flatMap((screen) => screen.blocks)
    .filter((block) => block.component === 'input-set')
    .map((block) => block.props);
}

describe('InputSetPropsSchema', () => {
  it('accepts every input-set instance in the base journey (check-availability and your-details)', () => {
    const instances = inputSetInstances(BASE);
    expect(instances).toHaveLength(2);
    for (const props of instances) {
      expect(InputSetPropsSchema.safeParse(props).success).toBe(true);
    }
  });

  it('accepts every input-set instance in the postcode-first variation', () => {
    const instances = inputSetInstances(POSTCODE_FIRST);
    expect(instances).toHaveLength(2);
    for (const props of instances) {
      expect(InputSetPropsSchema.safeParse(props).success).toBe(true);
    }
  });

  it('both required:true and required:false are real observed values across the two journeys', () => {
    const allFields = [...inputSetInstances(BASE), ...inputSetInstances(POSTCODE_FIRST)].flatMap(
      (props) => (props as { fields: { required: boolean }[] }).fields,
    );
    expect(allFields.some((f) => f.required === true)).toBe(true);
    expect(allFields.some((f) => f.required === false)).toBe(true);
  });

  it('rejects a field.kind outside the three observed values (text, email, tel)', () => {
    const result = InputSetPropsSchema.safeParse({
      fields: [{ label: 'Age', kind: 'number', required: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a field missing required — every observed instance supplies it explicitly', () => {
    const result = InputSetPropsSchema.safeParse({
      fields: [{ label: 'Postcode', kind: 'text' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty fields array', () => {
    const result = InputSetPropsSchema.safeParse({ fields: [] });
    expect(result.success).toBe(false);
  });
});
