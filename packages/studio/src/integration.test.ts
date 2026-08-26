/**
 * Integration test: render the broadband-switch journey with the sketch adapter
 * and verify the end-to-end output through the studio server.
 *
 * This is the seam test that confirms render → studio works together.
 * It does NOT import the store (ADR 0002 requires going through @design-space/store
 * for production use; in tests we use the journey data directly for determinism).
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createStudioServer } from './server.js';
import { render } from '@design-space/render';
import { sketchAdapter } from '@design-space/adapter-sketch';
import broadbandSwitch from '../../../examples/journeys/broadband-switch.json' with { type: 'json' };
import type { JourneyDocument } from '@design-space/journey-model';

const journey = broadbandSwitch as unknown as JourneyDocument;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bindServer(server: Server, teardown: (fn: () => void) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('unexpected address shape'));
        return;
      }
      teardown(() => server.close());
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('studio integration: broadband-switch rendered with sketch adapter', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function register(fn: () => void) {
    cleanup = fn;
  }

  it('the rendered document contains the prompt heading text from the first screen', async () => {
    const rendered = render(journey, sketchAdapter);
    const server = createStudioServer({ rendered });
    const base = await bindServer(server, register);
    const res = await fetch(`${base}/`);
    const text = await res.text();
    // First screen's prompt heading
    expect(text).toContain('Choose a new package');
  });

  // Until story 3.1, compare-set (and four siblings) had no sketch renderer, so this same
  // journey rendered with a visible GAP box in place of the packages table. Story 3.1 gave
  // the sketch adapter a renderer for every port component, so the premise these two tests
  // once checked — "compare-set is unimplemented" — is no longer true. Inverted to assert
  // what is now true instead of deleting the coverage: the real journey renders end to end
  // with nothing missing.
  it('the full journey renders with zero gaps now that every port component has a sketch renderer (story 3.1)', () => {
    const rendered = render(journey, sketchAdapter);
    expect(rendered.gaps).toHaveLength(0);
  });

  it('real compare-set content — the package names — appears in the page; no gap element is present anywhere', async () => {
    const rendered = render(journey, sketchAdapter);
    const server = createStudioServer({ rendered });
    const base = await bindServer(server, register);
    const res = await fetch(`${base}/`);
    const text = await res.text();
    // Real table content from browse-packages' compare-set block, not a gap placeholder.
    expect(text).toContain('Family');
    expect(text).toContain('Full Fibre');
    expect(text).toContain('ds-compare-set');
    expect(text).not.toContain('class="ds-gap"');
  });

  it('the rendered HTML document has an inline style block (no external network calls needed)', async () => {
    const rendered = render(journey, sketchAdapter);
    const server = createStudioServer({ rendered });
    const base = await bindServer(server, register);
    const res = await fetch(`${base}/`);
    const text = await res.text();
    expect(text).toContain('<style>');
  });
});
