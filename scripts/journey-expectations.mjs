#!/usr/bin/env node
/**
 * Derive, from a journey document, the strings that must appear in the rendered page.
 *
 * The smoke test used to assert one hard-coded heading. That is one screen of five, so a change
 * that rendered only the first screen — or dropped the last three — passed the gate that ADR
 * 0007 leans its entire ordering on. `journey-smoke-coverage` asks for each documented journey
 * to be exercised, and a single literal is not that.
 *
 * Deriving the expectations FROM the journey rather than restating them is the point: a screen
 * added to the journey is automatically a screen the smoke requires, so the coverage cannot
 * silently stop tracking the journey it claims to cover.
 *
 * Usage: node journey-expectations.mjs <path-to-journey.json>   # one expectation per line
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The prompt heading of every screen, in journey order, de-duplicated.
 *
 * Headings only, deliberately. They are the one thing every screen has and the one thing the
 * renderer demonstrably emits — the previous single-literal check proved that against the live
 * service. Asserting on action labels or component internals as well would couple the smoke to
 * the adapter's markup, so a sketch-adapter restyle would fail a deploy that is fine.
 */
export function expectationsFor(journey) {
  const screens = journey?.screens;
  if (!Array.isArray(screens) || screens.length === 0) {
    throw new Error('journey document has no screens — nothing to smoke against');
  }

  const headings = [];
  for (const screen of screens) {
    for (const block of screen?.blocks ?? []) {
      if (block?.component === 'prompt' && typeof block?.props?.heading === 'string') {
        headings.push(block.props.heading);
      }
    }
  }

  if (headings.length === 0) {
    throw new Error('no screen carries a prompt heading — the smoke would assert nothing');
  }

  return [...new Set(headings)];
}

/** Read a journey document from disk and return its expectations. */
export function expectationsForFile(path) {
  return expectationsFor(JSON.parse(readFileSync(path, 'utf-8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error('usage: journey-expectations.mjs <path-to-journey.json>');
    process.stdout.write(`${expectationsForFile(path).join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`journey-expectations: ${err.message}\n`);
    process.exit(1);
  }
}
