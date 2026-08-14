#!/usr/bin/env node
/**
 * Decide whether a commit's checks are green.
 *
 * The promotion workflow is itself a check on the commit it is promoting, so a naive "wait for
 * every check to complete" deadlocks: this run can never complete while it is waiting for
 * itself. The exclusion is therefore not a convenience, it is the difference between a gate and
 * a hang — which is exactly why it lives here, as a pure function with tests, rather than in a
 * `run:` block that only executes when its trigger fires.
 *
 * Usage (CLI): the check-runs API response is read from stdin, the names to exclude are the
 * arguments.
 *
 *   gh api "repos/OWNER/REPO/commits/SHA/check-runs" | node checks-green.mjs "promote"
 *
 * Exit status is the verdict, so a caller can branch on it without parsing prose:
 *   0  green    — every considered check completed acceptably
 *   2  pending  — at least one check has not finished, and none has failed
 *   1  blocked  — at least one check failed, OR there were no checks to consider
 */

import { pathToFileURL } from 'node:url';

/**
 * Conclusions that do not block a promotion.
 *
 * `neutral` and `skipped` are included deliberately: a check that opted out of judging this
 * commit has not found a fault. `cancelled`, `timed_out`, `action_required`, `stale` and
 * `failure` all block — a cancelled check produced no verdict, and treating "no verdict" as
 * "no problem" is how an unreviewed change reaches production.
 */
export const NON_BLOCKING_CONCLUSIONS = Object.freeze(['success', 'neutral', 'skipped']);

/**
 * Drop the checks whose names appear in `excludedNames`.
 *
 * Matching is exact. A substring match would be worse than useless here: a workflow named
 * `promote` would also exclude `promote-and-deploy`, silently widening the hole from "ignore
 * myself" to "ignore anything that looks like me".
 *
 * @param {ReadonlyArray<{name: string}>} checks
 * @param {ReadonlyArray<string>} excludedNames
 */
export function excludeSelf(checks, excludedNames) {
  const excluded = new Set(excludedNames);
  return checks.filter((check) => !excluded.has(check.name));
}

/**
 * Reduce a set of check runs to a single verdict.
 *
 * @param {ReadonlyArray<{name: string, status: string, conclusion: string|null}>} checks
 * @param {ReadonlyArray<string>} excludedNames
 * @returns {{state: 'green'|'pending'|'failed'|'empty', pending: string[], failed: string[], considered: number}}
 */
export function summariseChecks(checks, excludedNames = []) {
  const considered = excludeSelf(checks, excludedNames);
  const pending = [];
  const failed = [];

  for (const check of considered) {
    if (check.status !== 'completed') {
      pending.push(check.name);
      continue;
    }
    if (!NON_BLOCKING_CONCLUSIONS.includes(check.conclusion)) {
      failed.push(check.name);
    }
  }

  // Order matters: a failure outranks a pending check, because waiting for the rest of a suite
  // that has already failed only delays the same answer.
  let state;
  if (failed.length > 0) {
    state = 'failed';
  } else if (pending.length > 0) {
    state = 'pending';
  } else if (considered.length === 0) {
    // Nothing to consider is NOT green. A misconfigured trigger, a wrong SHA, or a required
    // workflow that never started all produce an empty list, and reading that as "all clear"
    // would promote a commit whose corpus review never ran — the one thing this gate exists
    // to prevent.
    state = 'empty';
  } else {
    state = 'green';
  }

  return { state, pending, failed, considered: considered.length };
}

/** The process exit status that corresponds to a verdict. */
export function exitCodeFor(state) {
  if (state === 'green') return 0;
  if (state === 'pending') return 2;
  return 1;
}

/** A one-line human summary naming the checks responsible for the verdict. */
export function describeVerdict(summary) {
  switch (summary.state) {
    case 'green':
      return `green — ${summary.considered} check(s) passed`;
    case 'pending':
      return `pending — waiting on: ${summary.pending.join(', ')}`;
    case 'failed':
      return `failed — ${summary.failed.join(', ')}`;
    default:
      return 'empty — no checks found for this commit, which is not the same as passing';
  }
}

/**
 * Pull the check-run array out of whatever the API handed back.
 *
 * Accepts the `{check_runs: [...]}` envelope and a bare array, so a caller that has already
 * unwrapped the response is not punished for it.
 */
export function parseCheckRuns(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.check_runs)) return parsed.check_runs;
  throw new Error('unrecognised check-runs payload: expected an array or {check_runs: [...]}');
}

async function main() {
  const excluded = process.argv.slice(2);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);

  const summary = summariseChecks(parseCheckRuns(Buffer.concat(chunks).toString('utf-8')), excluded);
  process.stdout.write(`${describeVerdict(summary)}\n`);
  process.exit(exitCodeFor(summary.state));
}

// Only run the CLI when invoked directly, so the module can be imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`checks-green: ${err.message}\n`);
    process.exit(1);
  });
}
