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
 * TOCTOU. Verifying a PATH and then handing that same path to a fresh, independent `node`
 * invocation leaves a window — a file swapped in between the hash and the spawn would run
 * unverified, carrying this process's credentials, and nothing would know. To close as much of
 * that window as this file's execution model allows: the EXACT bytes just hashed are written to
 * a freshly created, uniquely named copy in the sibling script's own directory, and THAT copy —
 * never the original path again — is what gets spawned. This is a narrowing, not a complete
 * closure, and it is described that way deliberately: the one read that produces those bytes is
 * not itself protected from a torn read (content changing mid-syscall while the OS services the
 * call), which is inherent to reading any file without OS-level atomic-snapshot support and
 * remains open. What this removes is the much larger window the previous version left: the
 * entire duration between the hash finishing and node's own, independent re-read of the same
 * still-mutable path.
 *
 * Executing the already-verified bytes via a buffer (piping them into `node -`, or
 * `node --input-type=module -e`) was considered and rejected. The sibling script's own `isMain`
 * guard compares `import.meta.url` to `process.argv[1]`; neither invocation form gives that
 * comparison a real `file://` URL naming an actual file to match against, so the script would
 * load, run its top-level declarations, and do nothing — a credentialed run that LOOKS complete
 * having reviewed nothing, which is worse than the gap it would have closed. Placing the copy
 * in TARGET's own directory, rather than some unrelated temp location, matters for the same
 * reason: `run-pregate.mjs` locates its own build output via `dirname(import.meta.url)`
 * (`scriptRepoRoot()`), and that self-location must still resolve to the real sibling checkout.
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
 * PREGATE_SPAWN_TIMEOUT_MS overrides the wrapper's own spawn bound, for the same reason.
 *
 * WHAT THE CHILD ACTUALLY RECEIVES. Not this process's own environment, wholesale — an
 * explicit, minimal one, built fresh from ALLOWED_SPAWN_ENV_VARS below. A wrapper whose whole
 * reason to exist is not trusting what it is asked to run must equally not trust that whatever
 * narrowed ITS OWN environment on the way in will always do so; the narrowing here is
 * independent, so the guarantee holds even if that outer one is ever loosened or bypassed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // scripts/ -> repo root

export function resolveTarget(env = process.env) {
  return resolve(REPO_ROOT, env.PREGATE_TARGET_SCRIPT ?? '../capabilities/scripts/run-pregate.mjs');
}

export function resolvePinFile(env = process.env) {
  return resolve(REPO_ROOT, env.PREGATE_PIN_FILE ?? 'scripts/pregate.sha256');
}

export const PIN_SHAPE = /^[0-9a-f]{64}$/;

/**
 * Environment variables the sibling script — and the child IT SPAWNS in turn — are known to
 * need. Derived directly from ../capabilities/scripts/run-pregate.mjs, read before choosing
 * this list, not assumed:
 *   - CLAUDE_CODE_OAUTH_TOKEN, AIGENCY_GUARDRAILS_TOKEN — the two credentials this wrapper
 *     exists to carry; read directly by planLocalPreGate.
 *   - PATH — run-pregate.mjs itself does `spawn('node', [plan.bin, ...argv], ...)`, a bare
 *     command name resolved against PATH (not process.execPath); without it that NESTED spawn
 *     cannot find `node` at all.
 *   - HOME — planLocalPreGate calls node:os `homedir()` to locate `~/.pi/agent/mcp.json`
 *     before the ambient-token short-circuit is even reached; an unset HOME can throw before
 *     that check runs.
 *   - TMPDIR — this repository's own aigency.json already narrows the declared `pregate` row
 *     to exactly this set (PATH, HOME, TMPDIR, plus the two tokens). Mirrored here rather than
 *     re-derived, because scratch space is used well beneath run-pregate.mjs — corpus checkout,
 *     mkdtemp calls — in code this wrapper does not itself walk.
 *
 * Absent, deliberately: GITHUB_TOKEN (a corpus-token fallback this wrapper does not choose to
 * offer — AIGENCY_GUARDRAILS_TOKEN is the one credential this repository's own declared row
 * names), AIGENCY_GUARDRAILS_URL and AIGENCY_MODEL_REASONING (both have working defaults in the
 * code that reads them), and every PREGATE_* override read by run-pregate.mjs itself (this
 * wrapper's PREGATE_* variables configure THIS file, not the child; conflating the two would
 * let a variable meant for the wrapper silently retarget the panel it spawns).
 */
export const ALLOWED_SPAWN_ENV_VARS = Object.freeze([
  'PATH',
  'HOME',
  'TMPDIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AIGENCY_GUARDRAILS_TOKEN',
]);

/**
 * Build the child's environment from ALLOWED_SPAWN_ENV_VARS only. Pure and exported so the
 * boundary itself — not merely that the two tokens survive it — is directly testable: a caller
 * asserting only "the tokens are present" would pass under a leak just as easily as under this.
 */
export function minimalEnv(env = process.env) {
  const out = {};
  for (const key of ALLOWED_SPAWN_ENV_VARS) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * How long to let the spawned panel run before this wrapper gives up and reports it, rather
 * than waiting on a hang with no diagnostic at all.
 *
 * Sits ON PURPOSE between the panel's own two layers: ABOVE run-pregate.mjs's own
 * DEFAULT_RUN_TIMEOUT_MS (30 minutes), so a genuinely wedged LENS is reported by the panel
 * itself, by name, before this wrapper would ever fire; BELOW the release step's own declared
 * timeoutMs (aigency.json's `pregate` row, 40 minutes), so a spawn wedged for some other reason
 * is reported HERE, with a message, rather than silently SIGKILLed by the runtime with none.
 */
export const DEFAULT_SPAWN_TIMEOUT_MS = 35 * 60_000;

export function spawnTimeoutMs(env = process.env) {
  const raw = env.PREGATE_SPAWN_TIMEOUT_MS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_SPAWN_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SPAWN_TIMEOUT_MS;
}

/**
 * Turn a completed spawnSync result into a legible outcome. Pure and exported so this — the
 * spawn-failure and timeout reporting the resilience lens found missing — is directly testable
 * without actually spawning a hung or missing process.
 *
 * Three shapes, all previously swallowed into a bare `exit(1)`:
 *   - `result.error` set — spawnSync could not even START the child. Previously: nothing on
 *     stderr at all.
 *   - `result.signal` set, `result.status` null — the child was killed by a signal, either this
 *     wrapper's own timeout or something external. Previously: silent exit(1).
 *   - otherwise — the child ran to completion; its own exit code is authoritative and is
 *     propagated as-is, success or failure.
 */
export function describeSpawnResult(result, limitMs = DEFAULT_SPAWN_TIMEOUT_MS) {
  // spawnSync's OWN timeout option reports as result.error with code ETIMEDOUT — not merely as
  // result.signal — so this must be distinguished from a genuine could-not-start failure (e.g.
  // ENOENT) before the generic result.error branch below, or a legible timeout message would
  // never be reached.
  if (result.error && result.error.code === 'ETIMEDOUT') {
    return {
      exitCode: 1,
      message:
        `verified-pregate: the panel did not finish within this wrapper's own ` +
        `${Math.round(limitMs / 60_000)}-minute bound and was terminated.`,
    };
  }
  if (result.error) {
    return {
      exitCode: 1,
      message: `verified-pregate: could not start the verified copy — ${result.error.message}`,
    };
  }
  if (result.signal) {
    return {
      exitCode: 1,
      message:
        `verified-pregate: the panel did not finish and was terminated by signal ` +
        `${result.signal} (this wrapper's own ${Math.round(limitMs / 60_000)}-minute bound, ` +
        `or an external signal).`,
    };
  }
  return { exitCode: result.status ?? 1, message: null };
}

/**
 * Write TARGET's already-verified bytes to a fresh, uniquely named file in TARGET's own
 * directory, and return its path. Pulled out of the isMain shim, with `write` injectable, so
 * the staging-failure branch — previously reachable only by luck (a full disk, a read-only
 * directory) — is directly testable without depending on the filesystem's own failure modes.
 */
export function stageVerifiedCopy(targetDir, bytes, { write = writeFileSync } = {}) {
  const copyPath = join(targetDir, `.verified-pregate.${randomBytes(8).toString('hex')}.tmp.mjs`);
  try {
    write(copyPath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    throw new Error(`could not stage a verified copy at ${copyPath} — ${err.message}`);
  }
  return copyPath;
}

function refuse(message) {
  process.stderr.write(`verified-pregate: refusing to run — ${message}\n`);
  process.exit(1);
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

/* c8 ignore start — the verify-and-spawn shim; the decisions above are what is unit tested. */
if (isMain) {
  const TARGET = resolveTarget();
  const PIN_FILE = resolvePinFile();

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

  // Read ONCE. Both the hash and the copy below come from this same buffer — never a second,
  // independent read of TARGET — so nothing between verification and execution can observe two
  // different versions of "the file".
  const bytes = readFileSync(TARGET);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== pinned) {
    refuse(
      `${TARGET} does not match the pinned digest.\n` +
        `  pinned: ${pinned}\n` +
        `  actual: ${actual}\n` +
        `The sibling checkout has changed since this pin was set. If the change is legitimate, ` +
        `review it and update ${PIN_FILE} deliberately; if it is not, do not proceed.`,
    );
  }

  // Verified: only past this point does anything with credential-bearing environment get
  // spawned — and what gets spawned is a copy of the bytes just verified, in TARGET's own
  // directory, never TARGET itself again. See the file header for the full reasoning and the
  // residual risk this narrows but does not eliminate.
  let copyPath;
  try {
    copyPath = stageVerifiedCopy(dirname(TARGET), bytes);
  } catch (err) {
    refuse(err.message);
  }

  const limitMs = spawnTimeoutMs();
  let result;
  try {
    result = spawnSync(process.execPath, [copyPath, ...process.argv.slice(2)], {
      stdio: 'inherit',
      timeout: limitMs,
      env: minimalEnv(),
    });
  } finally {
    try {
      unlinkSync(copyPath);
    } catch {
      // Best-effort. A stray verified copy left behind is untidy, not unsafe: it carries no
      // credential of its own and nothing treats its presence as meaningful.
    }
  }

  const outcome = describeSpawnResult(result, limitMs);
  if (outcome.message) process.stderr.write(`${outcome.message}\n`);
  process.exit(outcome.exitCode);
}
/* c8 ignore stop */
