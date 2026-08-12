/**
 * The JSON Schema artefact is the discoverable description of a journey document — the thing a
 * caller, a tool or an agent can inspect without reading the source.
 *
 * It is EMITTED at build time, which means it can silently fail to be produced while the build
 * still exits zero. That is exactly what happened once: the emitter was wired to a package
 * script the root build never invoked, so `npm run verify` was green while the artefact did not
 * exist at all. These tests exist so that cannot recur silently — they fail if the artefact is
 * missing, and they fail if it has drifted from the Zod schema it is supposed to be derived from.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { JourneyDocumentSchema } from './schema.js';

const artefactPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../dist/journey-document.schema.json',
);

describe('the JSON Schema artefact', () => {
  it('is produced by the build', async () => {
    const raw = await readFile(artefactPath, 'utf-8').catch(() => null);

    expect(
      raw,
      `No JSON Schema artefact at ${artefactPath}. The build is supposed to emit it — a green ` +
        'build with no artefact means the emitter was never invoked.',
    ).not.toBeNull();
  });

  it('is derived from the Zod schema rather than maintained alongside it', async () => {
    const onDisk: unknown = JSON.parse(await readFile(artefactPath, 'utf-8'));
    const fromSource: unknown = JSON.parse(
      JSON.stringify(
        zodToJsonSchema(JourneyDocumentSchema, { name: 'JourneyDocument', $refStrategy: 'none' }),
      ),
    );

    expect(
      onDisk,
      'The artefact on disk differs from what the Zod schema generates, so the two have drifted. ' +
        'Rebuild — and if that does not resolve it, the artefact is being hand-maintained, which ' +
        'is the failure the single-source rule exists to prevent.',
    ).toEqual(fromSource);
  });
});
