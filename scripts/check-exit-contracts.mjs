#!/usr/bin/env node
/**
 * check-exit-contracts.mjs
 *
 * A general check for the pattern the `testing` review found on rollback.sh: a script's own
 * "Exit status:" doc comment names a genuine THIRD outcome beyond plain success/failure — a
 * specific literal code sitting alongside another literal code or a generic "other" bucket —
 * but its tests verify the non-happy path only with `not.toBe(0)`. That assertion is satisfied
 * identically whichever non-zero outcome actually fired, so it cannot tell "the documented
 * refusal code" apart from "the documented incident code", which is exactly what let
 * rollback.sh's already-merged path (documented exit 2, alongside a generic `n` "other, an
 * incident" bucket) go unverified: the test only proved "not 0", which a general-failure
 * `exit 1` would have satisfied identically.
 *
 * WHAT COUNTS AS A "GENUINE THIRD OUTCOME". A script documenting only `0` and `1` — or `0` and
 * a generic `n` — has a real contract of exactly two categories, and `not.toBe(0)` already IS
 * the precise assertion for it: there is nothing else it could be. The trigger here is THREE OR
 * MORE distinct documented categories (a literal code counts as one category each; a bare `n` /
 * "other" placeholder line counts as exactly one more, however many actual numbers it covers) —
 * because that is the shape where "not zero" stops being precise: it is also true of every
 * OTHER non-zero category, and a test asserting only that cannot have noticed the difference.
 *
 * WHAT THIS CHECKS. For every git-TRACKED `.sh` / `.mjs` file under `scripts/`, parse its own
 * "Exit status:" doc comment for literal integer codes and whether it also documents a generic
 * `n` / "other" outcome. Where the total category count is 3 or more, every literal NON-ZERO
 * code among them must appear as a `.toBe(<code>)` / `.toEqual(<code>)` assertion somewhere in a
 * git-tracked test file that also mentions the script by name.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, stated plainly rather than left to be discovered. It does
 * not confirm the assertion exercises the RIGHT branch — only that the literal code appears,
 * textually, in a test file that also mentions the script. A large shared test file covering
 * many scripts (tests/promote-scripts.test.ts is exactly this) could in principle satisfy this
 * for a code that belongs to a different test entirely, if the numbers happened to collide.
 * Closing that would need each assertion tied to the same `describe()` block as the script's own
 * name, which this file does not attempt — the incremental cost was judged not worth it against
 * what this reliably catches, which is the actual failure mode found on rollback.sh: a
 * documented multi-outcome contract with NO precise assertion ANYWHERE for one of its codes.
 * That failure mode produces a MISSING match, not a wrong one, so this heuristic finds it, and a
 * fixture-driven regression test in tests/exit-contracts.test.ts proves that directly rather
 * than trusting this description.
 *
 * Usage: node scripts/check-exit-contracts.mjs
 * Exit status:
 *   0  every documented multi-outcome exit contract in the tree is precisely asserted
 *   1  at least one documented code has no precise assertion anywhere — see stderr
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Strip a `#`, `*` or `//` comment marker and one following space.
 * Returns null for a line that is not a comment line at all — the signal used elsewhere to
 * decide a doc-comment block has ended.
 */
export function stripCommentMarker(line) {
  const trimmed = line.trim();
  const match = trimmed.match(/^(#+|\*|\/\/)\s*(.*)$/);
  return match ? match[2] : null;
}

/**
 * Pull the literal integer exit codes, and whether a generic `n` / "other" outcome is also
 * documented, out of a script's own "Exit status:" doc comment.
 *
 * @returns {{codes: Array<{code: number, description: string}>, sawGeneric: boolean}}
 */
export function extractDocumentedExitCodes(source) {
  const lines = source.split('\n');
  const codes = [];
  let inSection = false;
  let sawGeneric = false;

  for (const raw of lines) {
    const content = stripCommentMarker(raw);
    if (content === null) {
      if (inSection) break; // left the comment block entirely
      continue;
    }
    if (!inSection) {
      if (/exit status/i.test(content)) inSection = true;
      continue;
    }
    if (content === '') {
      // A blank comment line ends the list once it has started; before that it is just
      // whitespace between "Exit status:" and the first entry.
      if (codes.length > 0 || sawGeneric) break;
      continue;
    }
    const codeMatch = content.match(/^(\d+)\s+(.*)$/);
    if (codeMatch) {
      codes.push({ code: Number(codeMatch[1]), description: codeMatch[2] });
      continue;
    }
    if (/^n\b/i.test(content)) {
      sawGeneric = true;
      continue;
    }
    // Neither a numbered entry nor the generic placeholder — prose that follows the list, or a
    // single-line summary (mutation-check.sh's "Exit status: 0 only if ..." shape) that was
    // never a structured list to begin with.
    break;
  }

  return { codes, sawGeneric };
}

/** git-tracked files under `dir`, relative to `root`, filtered to the given extensions.
 *
 * Deliberately git-TRACKED rather than everything on disk: this repository routinely carries
 * untracked, throwaway helper scripts and generated output files in `scripts/` (declared as
 * such in aigency.json) that must never influence a committed check — using `git ls-files`
 * excludes them automatically, without this file needing to know their names.
 */
export function trackedFiles(dir, extensions, root = ROOT) {
  const out = execFileSync('git', ['ls-files', dir], { cwd: root, encoding: 'utf-8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && extensions.includes(`.${line.split('.').pop()}`));
}

/**
 * Every script under scripts/ whose own doc comment documents THREE OR MORE distinct outcomes —
 * the shape where `not.toBe(0)` stops being a precise assertion — together with the literal
 * non-zero codes among them that need one.
 */
export function scriptsWithMultiCodeContracts(root = ROOT) {
  const files = trackedFiles('scripts', ['.sh', '.mjs'], root);
  const result = [];
  for (const relPath of files) {
    const source = readFileSync(join(root, relPath), 'utf-8');
    const { codes, sawGeneric } = extractDocumentedExitCodes(source);
    const totalCategories = codes.length + (sawGeneric ? 1 : 0);
    if (totalCategories < 3) continue;

    const nonZero = codes.filter((c) => c.code !== 0);
    if (nonZero.length === 0) continue; // nothing literal to pin down precisely
    result.push({ relPath, codes: nonZero });
  }
  return result;
}

/** Every documented literal non-zero code, on a multi-outcome contract, with no precise
 * assertion anywhere in a test file that names the script. */
export function findUnassertedCodes(root = ROOT) {
  const testFiles = trackedFiles('tests', ['.ts'], root);
  const testContents = testFiles.map((relPath) => ({
    relPath,
    text: readFileSync(join(root, relPath), 'utf-8'),
  }));

  const findings = [];
  for (const script of scriptsWithMultiCodeContracts(root)) {
    const name = basename(script.relPath);
    const mentioning = testContents.filter((f) => f.text.includes(name));

    if (mentioning.length === 0) {
      findings.push({ script: script.relPath, code: null, description: 'no test file mentions this script at all' });
      continue;
    }

    for (const { code, description } of script.codes) {
      const preciselyAsserted = mentioning.some((f) => new RegExp(`\\.(toBe|toEqual)\\(\\s*${code}\\s*\\)`).test(f.text));
      if (!preciselyAsserted) {
        findings.push({ script: script.relPath, code, description, testFiles: mentioning.map((f) => f.relPath) });
      }
    }
  }
  return findings;
}

function main() {
  const findings = findUnassertedCodes();
  if (findings.length === 0) {
    process.stdout.write('check-exit-contracts: every documented multi-outcome exit contract is precisely asserted.\n');
    process.exit(0);
  }

  process.stderr.write('check-exit-contracts: FAILED — documented exit code(s) with no precise assertion:\n\n');
  for (const f of findings) {
    process.stderr.write(`  ${f.script}  exit ${f.code ?? '(none)'}  ${f.description ?? ''}\n`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
