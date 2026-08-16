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
 * pin moved. AGENTS.md § Operating this repo points here for the full procedure rather than
 * restating it, so this paragraph — not a copy of it — is the one place that owns it.
 *
 * Target and pin paths are overridable via PREGATE_TARGET_SCRIPT / PREGATE_PIN_FILE — relative
 * paths are resolved against this repository's root, absolute paths are used as-is — which
 * exists so tests can point this at disposable fixtures rather than the real sibling checkout.
 * PREGATE_SPAWN_TIMEOUT_MS and PREGATE_KILL_GRACE_MS override the wrapper's own spawn bound and
 * its escalation grace period, for the same reason.
 *
 * SECURITY. Both overrides above are read from THIS PROCESS'S OWN environment — the same
 * environment that also carries CLAUDE_CODE_OAUTH_TOKEN and AIGENCY_GUARDRAILS_TOKEN into
 * whatever gets spawned. Whoever can set one can set the other, and someone who controls BOTH
 * PREGATE_TARGET_SCRIPT and PREGATE_PIN_FILE controls the file being verified AND the digest it
 * is verified against — the digest check becomes a comparison of an attacker's file to an
 * attacker's own hash of it, true by construction, while the credentialed spawn still happens.
 * The pin only means something if the location it can point at is not itself arbitrary, so
 * resolveTarget/resolvePinFile REFUSE any override that does not resolve inside the OS temp
 * directory or a `.tmp-verified-pregate-test-` subtree of this repository — see
 * isFixtureLocation below, and the exact shape every fixture in tests/verified-pregate.test.ts
 * already uses. RESIDUAL RISK, stated rather than hidden: this narrows the reachable set, it
 * does not remove attacker control of the environment as a threat. Anyone able to set these two
 * variables for the real credentialed run and ALSO able to write into the OS temp directory (a
 * materially weaker bar than modifying this repository or the sibling checkout, but not
 * nothing) could still stage a matching, self-verifying pair there. Closing that fully would
 * mean this wrapper honours no override at all in a credentialed run — not done here, because
 * it would also remove the only way this file's own tests exercise the real CLI entry point,
 * which is by spawning it as a genuine subprocess against disposable fixtures.
 *
 * WHAT THE CHILD ACTUALLY RECEIVES. Not this process's own environment, wholesale — an
 * explicit, minimal one, built fresh from ALLOWED_SPAWN_ENV_VARS below. A wrapper whose whole
 * reason to exist is not trusting what it is asked to run must equally not trust that whatever
 * narrowed ITS OWN environment on the way in will always do so; the narrowing here is
 * independent, so the guarantee holds even if that outer one is ever loosened or bypassed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // scripts/ -> repo root

/**
 * Whether ABS_PATH lies inside one of the two locations this wrapper trusts as disposable test
 * fixtures: the OS temp directory, or a `.tmp-verified-pregate-test-` prefixed subtree directly
 * under this repository's root — the exact shape every PREGATE_TARGET_SCRIPT / PREGATE_PIN_FILE
 * override in tests/verified-pregate.test.ts already uses. Exported so the boundary itself is
 * directly testable, not merely its effect on resolveTarget/resolvePinFile. `tmpDir`/`repoRoot`
 * are injectable for the same reason the rest of this file prefers injection to reaching for
 * globals inside test scope.
 */
export function isFixtureLocation(absPath, { tmpDir = tmpdir(), repoRoot = REPO_ROOT } = {}) {
  const t = resolve(tmpDir);
  const p = resolve(absPath);
  if (p === t || p.startsWith(t + sep)) return true;
  const marker = resolve(repoRoot, '.tmp-verified-pregate-test-');
  return p.startsWith(marker);
}

function resolveOverridable(env, envVar, defaultRelative, repoRoot, isFixture) {
  const override = env[envVar];
  const resolved = resolve(repoRoot, override ?? defaultRelative);
  if (override !== undefined && !isFixture(resolved)) {
    throw new Error(
      `${envVar} redirects verification to ${resolved}, outside the locations this wrapper ` +
        `trusts as disposable test fixtures (the OS temp directory, or a ` +
        `.tmp-verified-pregate-test- subtree of this repository). Refusing: a target and its ` +
        `pin can both be set through the environment, and the digest check only means ` +
        `something if the location it verifies is not itself redirectable to anywhere on disk.`,
    );
  }
  return resolved;
}

export function resolveTarget(env = process.env) {
  return resolveOverridable(
    env,
    'PREGATE_TARGET_SCRIPT',
    '../capabilities/scripts/run-pregate.mjs',
    REPO_ROOT,
    isFixtureLocation,
  );
}

export function resolvePinFile(env = process.env) {
  return resolveOverridable(
    env,
    'PREGATE_PIN_FILE',
    'scripts/pregate.sha256',
    REPO_ROOT,
    isFixtureLocation,
  );
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
 *   - TMPDIR — needed because scratch space is used well beneath run-pregate.mjs — corpus
 *     checkout, mkdtemp calls — in code this wrapper does not itself walk. NOT narrowed by
 *     aigency.json's own `env` declaration for the `pregate` row, which lists only the two
 *     credentials above (`CLAUDE_CODE_OAUTH_TOKEN`, `AIGENCY_GUARDRAILS_TOKEN`) and says
 *     nothing about PATH, HOME or TMPDIR — those three arrive through ordinary process
 *     environment inheritance when the release runner spawns THIS script, not through that
 *     declaration. This wrapper narrows its own child's environment independently, on its own
 *     terms, rather than assuming the runner's inheritance into IT is itself narrow.
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
 * than waiting on a hang with no diagnostic at all. The full three-layer arithmetic — this
 * bound, the panel's own inner backstop, and the release step's declared timeoutMs, and why
 * each must fire before the next — lives in AGENTS.md § Operating this repo, the single home
 * for it; this comment states only the two relationships that matter to reading THIS constant:
 * ABOVE run-pregate.mjs's own inner backstop, so a wedged LENS is reported by the panel itself,
 * by name, before this wrapper would ever fire; BELOW the release step's own declared
 * timeoutMs, so a spawn wedged for some other reason is reported HERE, with a message, rather
 * than silently SIGKILLed by the runtime with none.
 */
export const DEFAULT_SPAWN_TIMEOUT_MS = 35 * 60_000;

export function spawnTimeoutMs(env = process.env) {
  const raw = env.PREGATE_SPAWN_TIMEOUT_MS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_SPAWN_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SPAWN_TIMEOUT_MS;
}

/**
 * How long to wait, after a SIGTERM aimed at the whole process group on timeout, before
 * escalating to SIGKILL. A group member that ignores SIGTERM (or is itself mid-syscall) would
 * otherwise survive indefinitely under a wrapper that only ever asks nicely once — the same
 * "narrowing, not closure" the file header states for the TOCTOU window, applied here: SIGTERM
 * gives a well-behaved process the chance to exit cleanly; SIGKILL is the backstop for one that
 * does not take it.
 */
export const DEFAULT_KILL_GRACE_MS = 2000;

export function killGraceMs(env = process.env) {
  const raw = env.PREGATE_KILL_GRACE_MS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_KILL_GRACE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_KILL_GRACE_MS;
}

/**
 * Spawn the verified copy asynchronously, in its OWN detached process group, and wait for it to
 * finish or for the bound above to be reached.
 *
 * THE DEFECT THIS REPLACES. `run-pregate.mjs` spawns NESTED per-lens node processes of its own
 * (`spawn('node', [plan.bin, ...argv], ...)`, undetached — see ALLOWED_SPAWN_ENV_VARS above).
 * The previous version of this function used `spawnSync`'s built-in `timeout` option, which
 * signals ONLY the direct child by pid. Those nested lens processes, sharing that child's
 * process group by ordinary inheritance, were never signalled at all: on a timeout they
 * survived as orphans and kept making paid model calls after this wrapper had given up on them.
 * That is a live cost defect, and a silent one — nothing about the wrapper's own exit code or
 * message revealed that anything was still running.
 *
 * THE FIX, AND ITS HONEST LIMIT. `detached: true` makes the direct child (this copy of
 * run-pregate.mjs) the LEADER of a new process group, with pgid === child.pid. Any process it
 * spawns WITHOUT its own `detached: true` inherits that same group by ordinary OS behaviour —
 * which is exactly the shape `run-pregate.mjs`'s own nested spawn is, per the header comment
 * above. Signalling the NEGATIVE pid on timeout therefore reaches the child and every
 * undetached descendant of it in one OS-level call, delivered directly to each process rather
 * than routed through a parent that may already be gone. What this does NOT reach: a
 * descendant that deliberately detaches into a group of its own. Nothing here inspects
 * `run-pregate.mjs` to confirm its nested spawn stays undetached forever, so this is stated as
 * a narrowing tied to that script's CURRENT shape, not a guarantee independent of it — the same
 * distinction the file header draws for the TOCTOU window, and worth exactly the same amount of
 * scepticism if `run-pregate.mjs` ever changes how it spawns its own children.
 *
 * `spawnFn` is injectable so a test can substitute a stub without an OS process actually
 * existing to be killed.
 */
export function spawnVerifiedCopy(
  copyPath,
  args,
  { timeoutMs, env, killGraceMs: graceMs = DEFAULT_KILL_GRACE_MS, spawnFn = spawn } = {},
) {
  return new Promise((resolveOutcome) => {
    let settled = false;
    let timedOut = false;
    let timeoutTimer;
    let killTimer;

    const child = spawnFn(process.execPath, [copyPath, ...args], {
      stdio: 'inherit',
      env,
      detached: true,
    });

    const killGroup = (signal) => {
      if (typeof child.pid !== 'number') return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group may already be gone (everything already exited), or this platform has no
        // process-group semantics at all (Windows) — either way there is nothing further to do.
      }
    };

    /**
     * EXTERNAL SIGNALS — the layer ABOVE this wrapper's own timeoutMs, not this wrapper's own
     * internal bound. THE GAP THIS CLOSES: this wrapper spawns the panel `detached: true` so it
     * can group-kill the panel and everything nested under it on this wrapper's OWN timeout —
     * but `detached: true` also makes the panel the leader of a SECOND process group, separate
     * from this wrapper's own. When something outside this wrapper (the runtime's own runner,
     * enforcing its own timeoutMs, is the known case) sends SIGTERM to THIS wrapper's group,
     * that reaches this process — but never the panel's group, since a negative-pid signal to
     * one group does not reach a different one. Without a handler here, this wrapper dies on
     * the runner's follow-up SIGKILL and the panel — and everything nested under it — is
     * orphaned, running on unattended, still making paid model calls. The very detach that
     * closed the nested-grandchild gap on THIS wrapper's own timeout is what opened this one;
     * the fix is the same move applied one layer up: forward the signal.
     *
     * DELIBERATELY NOT a replay of this wrapper's own SIGTERM-then-wait-then-SIGKILL
     * escalation. That escalation's own grace period (killGraceMs, 2000ms by default) is the
     * SAME budget the runner grants THIS wrapper between its SIGTERM and its own SIGKILL —
     * waiting here would consume that whole budget, and the runner's SIGKILL for this wrapper
     * would land at essentially the same moment, quite possibly before any follow-up SIGKILL to
     * the panel had a chance to fire. So: forward SIGTERM to the panel's group immediately, and
     * let this process exit right away rather than waiting on anything.
     *
     * RESIDUAL, stated rather than hidden — same discipline as the TOCTOU window in the file
     * header: a panel that ignores SIGTERM here gets no guaranteed follow-up SIGKILL before
     * this wrapper itself is killed by whatever sent the original signal. Narrowed, not closed.
     */
    const forwardExternalSignal = (signal) => {
      killGroup('SIGTERM');
      // Registering a listener overrides Node's default terminate-on-SIGTERM/SIGINT
      // disposition, so this handler must exit explicitly rather than relying on it —
      // immediately, without waiting on the child's own 'exit' event, for the reason above.
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    const onExternalSigterm = () => forwardExternalSignal('SIGTERM');
    const onExternalSigint = () => forwardExternalSignal('SIGINT');
    process.once('SIGTERM', onExternalSigterm);
    process.once('SIGINT', onExternalSigint);

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      process.removeListener('SIGTERM', onExternalSigterm);
      process.removeListener('SIGINT', onExternalSigint);
      resolveOutcome(outcome);
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), graceMs);
    }, timeoutMs);

    child.on('error', (error) => finish({ error, status: null, signal: null, timedOut }));
    child.on('exit', (status, signal) => finish({ error: null, status, signal, timedOut }));
  });
}

/**
 * Turn a completed spawn outcome into a legible result. Pure and exported so this — the
 * spawn-failure and timeout reporting the resilience lens found missing — is directly testable
 * without actually spawning a hung or missing process.
 *
 * Shapes handled, all previously swallowed into a bare `exit(1)`:
 *   - `result.timedOut` — this wrapper's own bound was reached and it killed the process group
 *     itself (see spawnVerifiedCopy above). The primary path since that function stopped
 *     relying on spawnSync's own timeout option.
 *   - `result.error` with `code === 'ETIMEDOUT'` — kept for backward compatibility with a
 *     spawnSync-shaped result, in case anything else ever constructs one; reported identically.
 *   - `result.error` set otherwise — the child could not even be STARTED (e.g. ENOENT).
 *   - `result.signal` set, `result.status` null, `timedOut` false — killed by a signal that was
 *     not this wrapper's own timeout (something external).
 *   - otherwise — the child ran to completion; its own exit code is authoritative and is
 *     propagated as-is, success or failure.
 */
export function describeSpawnResult(result, limitMs = DEFAULT_SPAWN_TIMEOUT_MS) {
  if (result.timedOut) {
    return {
      exitCode: 1,
      message:
        `verified-pregate: the panel did not finish within this wrapper's own ` +
        `${Math.round(limitMs / 60_000)}-minute bound; its process group was terminated.`,
    };
  }
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

/**
 * `import.meta.url` percent-encodes characters a raw filesystem path does not (a space becomes
 * %20, and so on) — this repository's own checkout path could gain one at any time. The
 * previous version compared against the literal string `file://${process.argv[1]}`, which is
 * correct only when the path needs no such encoding; anywhere it does, the comparison silently
 * fails and this file loads, runs its top-level declarations, and does NOTHING — no refusal
 * message, no spawn, no non-zero exit: a credentialed run that looks complete having reviewed
 * nothing. pathToFileURL performs the same encoding import.meta.url already carries, so both
 * sides are compared on equal terms regardless of what characters the path contains.
 */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

/* c8 ignore start — the verify-and-spawn shim; the decisions above are what is unit tested. */
if (isMain) {
  let TARGET, PIN_FILE;
  try {
    TARGET = resolveTarget();
    PIN_FILE = resolvePinFile();
  } catch (err) {
    refuse(err.message);
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
  const graceMs = killGraceMs();
  let result;
  try {
    result = await spawnVerifiedCopy(copyPath, process.argv.slice(2), {
      timeoutMs: limitMs,
      killGraceMs: graceMs,
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
