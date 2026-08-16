#!/usr/bin/env node
/**
 * Verify, then invoke, the local antagonistic review panel script.
 *
 * `../capabilities/scripts/run-pregate.mjs` lives in a SIBLING repository, not this one, and is
 * therefore not versioned with the code it reviews: it can change — deliberately or not —
 * without any change landing here. `aigency.json`'s `pregate` row invokes THIS wrapper in its
 * place, and it is this wrapper that carries the real credentials
 * (`CLAUDE_CODE_OAUTH_TOKEN`, `AIGENCY_GUARDRAILS_TOKEN`) into whatever it decides to spawn.
 *
 * Before spawning anything, this reads a pinned SHA-256 digest from `scripts/pregate.sha256`
 * (one line, lowercase hex, committed to THIS repository), hashes the sibling script, and
 * refuses — loudly, on stderr, with a non-zero exit — on any mismatch or if the sibling script
 * is simply absent. Only a byte-for-byte match is allowed to proceed to the spawn.
 *
 * This turns "a modified sibling checkout gets both tokens, undetected" into "a modified
 * sibling checkout gets neither token, loudly." It does not make `run-pregate.mjs` trustworthy
 * on its own — it makes an UNNOTICED change to it impossible to run with this repository's
 * credentials.
 *
 * The pin is deliberate, never automatic: when `run-pregate.mjs` legitimately changes,
 * `scripts/pregate.sha256` must be updated in the SAME change, by computing the new digest
 * (`shasum -a 256 ../capabilities/scripts/run-pregate.mjs`, run from this repository's root)
 * and committing it. `scripts/pregate.sha256`'s own history is the record of when and why the
 * pin moved.
 *
 * Target and pin paths are overridable via PREGATE_TARGET_SCRIPT / PREGATE_PIN_FILE — relative
 * paths are resolved against this repository's root, absolute paths are used as-is — which
 * exists so tests can point this at disposable fixtures rather than the real sibling checkout.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // scripts/ -> repo root

const TARGET = resolve(
  REPO_ROOT,
  process.env.PREGATE_TARGET_SCRIPT ?? '../capabilities/scripts/run-pregate.mjs',
);
const PIN_FILE = resolve(REPO_ROOT, process.env.PREGATE_PIN_FILE ?? 'scripts/pregate.sha256');

const PIN_SHAPE = /^[0-9a-f]{64}$/;

function refuse(message) {
  process.stderr.write(`verified-pregate: refusing to run — ${message}\n`);
  process.exit(1);
}

if (!existsSync(PIN_FILE)) {
  refuse(`no pin file at ${PIN_FILE}. Nothing can be verified without one.`);
}

const pinned = readFileSync(PIN_FILE, 'utf-8').trim();
if (!PIN_SHAPE.test(pinned)) {
  refuse(`${PIN_FILE} does not hold a well-formed lowercase-hex SHA-256 digest.`);
}

if (!existsSync(TARGET)) {
  refuse(`${TARGET} does not exist. It cannot be verified, so it cannot be run.`);
}

const actual = createHash('sha256').update(readFileSync(TARGET)).digest('hex');
if (actual !== pinned) {
  refuse(
    `${TARGET} does not match the pinned digest.\n` +
      `  pinned: ${pinned}\n` +
      `  actual: ${actual}\n` +
      `The sibling checkout has changed since this pin was set. If the change is legitimate, ` +
      `review it and update ${PIN_FILE} deliberately; if it is not, do not proceed.`,
  );
}

// Verified: only past this point does anything with credential-bearing environment get spawned.
const result = spawnSync(process.execPath, [TARGET, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
