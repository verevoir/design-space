import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { validateJourney } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read one of the reference journey JSON files. */
function readJourney(filename: string): unknown {
  const p = resolve(__dirname, '../../../examples/journeys', filename);
  return JSON.parse(readFileSync(p, 'utf-8')) as unknown;
}

/** Deep-clone and mutate an object at a dot-bracket path (for building fixtures). */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Reference journeys — both must validate
// ---------------------------------------------------------------------------

describe('reference journeys validate', () => {
  it('broadband-switch base journey validates without errors', () => {
    const raw = readJourney('broadband-switch.json');
    const result = validateJourney(raw);
    expect(result.ok).toBe(true);
  });

  it('broadband-switch postcode-first variation validates without errors', () => {
    const raw = readJourney('broadband-switch.postcode-first.json');
    const result = validateJourney(raw);
    expect(result.ok).toBe(true);
  });

  it('postcode-first variation carries variationOf and variationBecause', () => {
    const raw = readJourney('broadband-switch.postcode-first.json');
    const result = validateJourney(raw);
    if (!result.ok) throw new Error('Expected valid journey');
    expect(result.document.variationOf).toBe('broadband-switch');
    expect(result.document.variationBecause).toContain('postcode');
  });

  it('null action target (leave journey) is accepted', () => {
    const raw = readJourney('broadband-switch.json');
    const result = validateJourney(raw);
    if (!result.ok) throw new Error('Expected valid journey');
    // The confirm screen has target: null actions
    const confirm = result.document.screens.find((s) => s.id === 'confirm');
    expect(confirm?.actions.some((a) => a.target === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rejection: missing required field
// ---------------------------------------------------------------------------

describe('rejects a document that is missing a required field', () => {
  it('rejects when top-level "title" is absent, naming the offending path', () => {
    const raw = readJourney('broadband-switch.json') as Record<string, unknown>;
    const bad = deepClone(raw);
    delete bad['title'];

    const result = validateJourney(bad);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('title');
  });

  it('rejects when a screen is missing "purpose", naming the offending path', () => {
    const raw = readJourney('broadband-switch.json') as Record<string, unknown>;
    const bad = deepClone(raw) as { screens: Array<Record<string, unknown>> };
     
    delete bad.screens[0]!['purpose'];

    const result = validateJourney(bad);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    const paths = result.errors.map((e) => e.path);
    expect(paths.some((p) => p.includes('screens[0]') && p.includes('purpose'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rejection: dangling action target
// ---------------------------------------------------------------------------

describe('rejects a document with a dangling action target', () => {
  it('rejects when an action target names a screen that does not exist', () => {
    const raw = readJourney('broadband-switch.json') as {
      screens: Array<{ actions: Array<{ target: string | null }> }>;
    };
    const bad = deepClone(raw);
    // Point the first action of the first screen to a non-existent screen.
     
    bad.screens[0]!.actions[0]!.target = 'no-such-screen';

    const result = validateJourney(bad);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    const matchingError = result.errors.find((e) =>
      e.path === 'screens[0].actions[0].target',
    );
    expect(matchingError).toBeDefined();
    expect(matchingError?.message).toContain('no-such-screen');
  });
});

// ---------------------------------------------------------------------------
// Rejection: unknown action weight
// ---------------------------------------------------------------------------

describe('rejects a document with an unknown action weight', () => {
  it('rejects when an action weight is not in the closed set, naming the path', () => {
    const raw = readJourney('broadband-switch.json') as {
      screens: Array<{ actions: Array<{ weight: string }> }>;
    };
    const bad = deepClone(raw);
    // Use a weight string outside the allowed enum.
     
    bad.screens[0]!.actions[0]!.weight = 'danger';

    const result = validateJourney(bad);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    const matchingError = result.errors.find((e) =>
      e.path.includes('screens[0]') &&
      e.path.includes('actions[0]') &&
      e.path.includes('weight'),
    );
    expect(matchingError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Rejection: unreachable screen
// ---------------------------------------------------------------------------

describe('rejects a document containing an unreachable screen', () => {
  it('rejects when a screen is neither the entry point nor targeted by any action', () => {
    const raw = readJourney('broadband-switch.json') as {
      entry: string;
      screens: Array<{ id: string; actions: Array<{ target: string | null }> }>;
    };
    const bad = deepClone(raw);

    // Add an orphan screen: not the entry, and no action targets it.
    (bad.screens as Array<{ id: string; purpose: string; blocks: unknown[]; actions: unknown[]; annotations: unknown[] }>).push({
      id: 'orphan-screen',
      purpose: 'This screen cannot be reached.',
      blocks: [],
      actions: [],
      annotations: [],
    });

    const result = validateJourney(bad);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    const reachabilityError = result.errors.find(
      (e) => e.message.includes('orphan-screen'),
    );
    expect(reachabilityError).toBeDefined();
    // Path should name the screen's position in the array.
    expect(reachabilityError?.path).toMatch(/screens\[\d+\]/);
  });

  it('error message for unreachable screen names the screen id', () => {
    const raw = readJourney('broadband-switch.json') as {
      screens: Array<{ id: string; actions: Array<{ target: string | null }> }>;
    };
    const bad = deepClone(raw) as {
      screens: Array<{ id: string; purpose: string; blocks: unknown[]; actions: unknown[]; annotations: unknown[] }>;
    };
    bad.screens.push({
      id: 'stranded',
      purpose: 'Unreachable.',
      blocks: [],
      actions: [],
      annotations: [],
    });

    const result = validateJourney(bad);
    if (result.ok) throw new Error('Expected failure');

    const err = result.errors.find((e) => e.message.includes('stranded'));
    expect(err).toBeDefined();
  });
});
