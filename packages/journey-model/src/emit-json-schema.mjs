/**
 * Emits a JSON Schema artefact derived from the Zod schema.
 *
 * Run after `tsc -b` so the compiled schema module is available.
 * The artefact lands at dist/journey-document.schema.json and is the single
 * machine-readable description of what a journey document must look like.
 *
 * This file is intentionally a plain .mjs so it can be run with
 * `node --input-type=module < src/emit-json-schema.mjs` without a build step
 * of its own — it only imports from the already-compiled dist/.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import from the compiled output so the types and schema stay in sync.
const { JourneyDocumentSchema } = await import(
  resolve(__dirname, '../dist/schema.js')
);

const jsonSchema = zodToJsonSchema(JourneyDocumentSchema, {
  name: 'JourneyDocument',
  $refStrategy: 'none',
});

const outPath = resolve(__dirname, '../dist/journey-document.schema.json');
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf-8');

console.log('Emitted dist/journey-document.schema.json');
