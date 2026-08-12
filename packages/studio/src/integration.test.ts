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

  it('labelled gaps are present for unimplemented components (not silently omitted)', async () => {
    const rendered = render(journey, sketchAdapter);
    const server = createStudioServer({ rendered });
    const base = await bindServer(server, register);
    const res = await fetch(`${base}/`);
    const text = await res.text();
    // compare-set is an unimplemented component; it must appear by name in a gap element
    expect(text).toContain('compare-set');
    expect(text).toContain('ds-gap');
  });

  it('the gap element naming compare-set is present — not silently skipped', async () => {
    const rendered = render(journey, sketchAdapter);
    // Verify the gap record is returned from render itself
    const compareGap = rendered.gaps.find((g) => g.component === 'compare-set');
    // If this assertion passes with compare-set simply absent from the output,
    // the test would fail — the gap must be in the array to make it here.
    expect(compareGap).toBeDefined();
    expect(compareGap?.screenId).toBe('browse-packages');
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
