import { describe, expect, it } from 'vitest';
import type { Block, JourneyDocument } from '@design-space/journey-model';
import { getContract, PORT_COMPONENTS, type ComponentName } from './registry.js';
import base from '../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import postcodeFirst from '../../../examples/journeys/broadband-switch.postcode-first.json' with { type: 'json' };

interface PlacedBlock {
  readonly screenId: string;
  readonly block: Block;
}

const JOURNEYS: readonly (readonly [string, JourneyDocument])[] = [
  ['broadband-switch', base as unknown as JourneyDocument],
  ['broadband-switch.postcode-first', postcodeFirst as unknown as JourneyDocument],
];

function placedBlocks(journey: JourneyDocument): readonly PlacedBlock[] {
  return journey.screens.flatMap((screen) =>
    screen.blocks.map((block) => ({ screenId: screen.id, block })),
  );
}

describe('PORT_COMPONENTS', () => {
  it('carries exactly the six components induced jointly from both reference journeys', () => {
    expect(Object.keys(PORT_COMPONENTS).sort()).toEqual(
      ['compare-set', 'input-set', 'option-list', 'prompt', 'status', 'summary'].sort(),
    );
  });

  it("every registered contract's own name matches the key it is stored under", () => {
    for (const [key, contract] of Object.entries(PORT_COMPONENTS)) {
      expect(contract.name).toBe(key as ComponentName);
    }
  });
});

// ---------------------------------------------------------------------------
// Story 2.1's own done-bar: "both reference journeys are expressible entirely
// in the induced port". Driven from the actual journey fixtures rather than
// hand-written literals, so this fails the moment a fixture changes to
// something the induced schemas do not admit.
// ---------------------------------------------------------------------------

describe('the induced port covers both reference journeys jointly (story 2.1 done-bar)', () => {
  for (const [journeyName, journey] of JOURNEYS) {
    const blocks = placedBlocks(journey);

    it(`${journeyName}: has at least one block to check (fixture sanity)`, () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    for (const { screenId, block } of blocks) {
      it(`${journeyName}/${screenId}: '${block.component}' block validates against its induced port schema`, () => {
        const contract = getContract(block.component);
        expect(
          contract,
          `no port contract registered for component '${block.component}' used on ${journeyName}/${screenId}`,
        ).toBeDefined();
        if (contract === undefined) return;
        const result = contract.propsSchema.safeParse(block.props);
        expect(
          result.success,
          result.success
            ? undefined
            : `props for '${block.component}' on ${journeyName}/${screenId} failed the induced schema: ` +
                JSON.stringify(result.error.issues),
        ).toBe(true);
      });
    }
  }
});
