import { describe, expect, it } from 'vitest';
import type { JourneyDocument } from '@design-space/journey-model';
import { SummaryPropsSchema } from './summary.js';
import base from '../../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import postcodeFirst from '../../../../examples/journeys/broadband-switch.postcode-first.json' with { type: 'json' };

const BASE = base as unknown as JourneyDocument;
const POSTCODE_FIRST = postcodeFirst as unknown as JourneyDocument;

function summaryInstances(journey: JourneyDocument): readonly { rows: { label: string; editTarget?: string }[] }[] {
  return journey.screens
    .flatMap((screen) => screen.blocks)
    .filter((block) => block.component === 'summary')
    .map((block) => block.props as { rows: { label: string; editTarget?: string }[] });
}

describe('SummaryPropsSchema', () => {
  it('accepts the confirm-screen instance in the base journey (4 rows)', () => {
    const [props] = summaryInstances(BASE);
    expect(props?.rows).toHaveLength(4);
    expect(SummaryPropsSchema.safeParse(props).success).toBe(true);
  });

  it('accepts the confirm-screen instance in the postcode-first variation (4 rows, reordered)', () => {
    const [props] = summaryInstances(POSTCODE_FIRST);
    expect(props?.rows).toHaveLength(4);
    expect(SummaryPropsSchema.safeParse(props).success).toBe(true);
  });

  it('the two journeys really do disagree on row order — this is the reconciliation the story asked for', () => {
    const [basedProps] = summaryInstances(BASE);
    const [variantProps] = summaryInstances(POSTCODE_FIRST);
    // Base journey: Package first. Postcode-first variation: Address first.
    // Order is data the schema does not constrain, not a shape disagreement —
    // both instances validate against the identical rows shape regardless.
    expect(basedProps?.rows[0]?.label).toBe('Package');
    expect(variantProps?.rows[0]?.label).toBe('Address');
  });

  it('every row in both journeys carries editTarget — modelled as required, not optional', () => {
    const allRows = [...summaryInstances(BASE), ...summaryInstances(POSTCODE_FIRST)].flatMap(
      (props) => props.rows,
    );
    expect(allRows).toHaveLength(8);
    expect(
      allRows.every((row) => typeof row.editTarget === 'string' && row.editTarget.length > 0),
    ).toBe(true);
  });

  it('rejects a row missing editTarget', () => {
    const result = SummaryPropsSchema.safeParse({
      rows: [{ label: 'Package', value: 'Family' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty rows array', () => {
    const result = SummaryPropsSchema.safeParse({ rows: [] });
    expect(result.success).toBe(false);
  });
});
