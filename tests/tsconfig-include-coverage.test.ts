/**
 * Guard against the class of defect PR #11's own correctness review caught: tests/tsconfig.json's
 * `include` list is maintained by hand, and a new test file landing without an entry in it is
 * type-checked by nothing — `npm run build` exits 0 regardless, because `include` is what decides
 * what `tsc -b` ever looks at. dockerfile-project-references.test.ts shipped exactly that way:
 * added in the same commit as the Dockerfile fix it exists to prove, never added to `include`,
 * silently unchecked.
 *
 * This does not remove the hand-maintained list. A glob (`*.test.ts`) was tried first and
 * rejected: probed directly against a temporary full-glob build, it pulls in ten pre-existing
 * test files that fail to type-check under this project's strict settings for reasons that have
 * nothing to do with any single change — implicit `any` from importing an untyped `.mjs` script
 * with no declaration file, and `noUncheckedIndexedAccess` violations. Landing that glob would
 * have swapped one silent gap for a build break blocking everyone.
 *
 * Instead: every `tests/*.test.ts` file on disk must appear in exactly one of two places —
 * tests/tsconfig.json's own `include` array, or KNOWN_UNCHECKED below, where the entry is
 * REQUIRED to carry a non-empty `reason`. A file in neither is the exact silent gap this test
 * exists to close, and fails loudly, naming the file. A file in KNOWN_UNCHECKED with an empty or
 * missing reason is refused too — the reason is the whole point of the list; without it, "known"
 * is a lie, and it would be exactly as silent as omission.
 *
 * The file set is read from disk (`readdirSync('tests')`), not hardcoded here, and
 * tests/tsconfig.json's `include` array is read and parsed, not duplicated as a literal — a test
 * that reproduced either as its own expectation would go stale exactly as silently as the bug it
 * exists to catch.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');

interface UncheckedEntry {
  file: string;
  reason: string;
}

// Every currently-unchecked test file, with why. A file lands here only because it genuinely
// fails to type-check under tests/tsconfig.json's strict settings when included — verified
// directly against a temporary full-glob build, not assumed. Two error classes account for all
// ten; see backlog.md's 0.1 entry for the class and a pointer to pick it up deliberately.
const KNOWN_UNCHECKED: UncheckedEntry[] = [
  {
    file: 'ci-workflow-shape.test.ts',
    reason:
      'possibly-undefined: TS2345 at line 202 — an indexed/optional lookup used without a narrowing check.',
  },
  {
    file: 'dockerfile-runtime-deps.test.ts',
    reason:
      'possibly-undefined: TS2532/TS2345/TS2322 across four call sites — indexed/optional lookups used without narrowing.',
  },
  {
    file: 'exit-contracts.test.ts',
    reason:
      "implicit-any: imports '../scripts/check-exit-contracts.mjs', which has no declaration file (TS7016), cascading into two TS7006 parameters.",
  },
  {
    file: 'preview-workflow-shape.test.ts',
    reason:
      'possibly-undefined: TS2345/TS2532 — an indexed/optional lookup used without a narrowing check.',
  },
  {
    file: 'promote-decisions.test.ts',
    reason:
      'implicit-any: imports three undeclared .mjs scripts (checks-green, traffic-snapshot, journey-expectations), cascading into three TS7006 parameters.',
  },
  {
    file: 'promote-workflow-shape.test.ts',
    reason:
      "possibly-undefined: four TS18048 errors ('largest'/'secondLargest' possibly undefined) under noUncheckedIndexedAccess.",
  },
  {
    file: 'service-urls.test.ts',
    reason: "implicit-any: imports '../scripts/service-urls.mjs', which has no declaration file (TS7016).",
  },
  {
    file: 'smoke-sh.test.ts',
    reason:
      "implicit-any: imports '../scripts/journey-expectations.mjs' (TS7016), cascading into one TS7006 parameter.",
  },
  {
    file: 'upsert-preview-comment.test.ts',
    reason:
      "implicit-any: imports '../scripts/upsert-preview-comment.mjs', which has no declaration file (TS7016).",
  },
  {
    file: 'verified-pregate.test.ts',
    reason:
      "implicit-any: imports '../scripts/verified-pregate.mjs', which has no declaration file (TS7016).",
  },
];

// ---------------------------------------------------------------------------
// Pure logic — proven against fixtures, not just the real repository, so gutting either
// predicate to an unconditional pass would go red here even on a shipped config too small to
// exercise it on its own.
// ---------------------------------------------------------------------------

export function uncoveredTestFiles(
  diskFiles: string[],
  includeList: string[],
  knownUnchecked: UncheckedEntry[],
): string[] {
  const covered = new Set([...includeList, ...knownUnchecked.map((e) => e.file)]);
  return diskFiles.filter((f) => !covered.has(f)).sort();
}

export function unreasonedEntries(knownUnchecked: UncheckedEntry[]): string[] {
  return knownUnchecked
    .filter((e) => typeof e.reason !== 'string' || e.reason.trim().length === 0)
    .map((e) => e.file);
}

describe('uncoveredTestFiles', () => {
  it('flags a disk file that is in neither include nor knownUnchecked — the exact original defect', () => {
    expect(uncoveredTestFiles(['a.test.ts', 'b.test.ts'], ['a.test.ts'], [])).toEqual(['b.test.ts']);
  });

  it('accepts a file covered by include', () => {
    expect(uncoveredTestFiles(['a.test.ts'], ['a.test.ts'], [])).toEqual([]);
  });

  it('accepts a file covered by knownUnchecked', () => {
    expect(uncoveredTestFiles(['a.test.ts'], [], [{ file: 'a.test.ts', reason: 'debt' }])).toEqual([]);
  });

  it('reports every uncovered file, not just the first', () => {
    expect(uncoveredTestFiles(['a.test.ts', 'b.test.ts', 'c.test.ts'], [], [])).toEqual([
      'a.test.ts',
      'b.test.ts',
      'c.test.ts',
    ]);
  });
});

describe('unreasonedEntries', () => {
  it('flags a knownUnchecked entry with an empty reason', () => {
    expect(unreasonedEntries([{ file: 'a.test.ts', reason: '' }])).toEqual(['a.test.ts']);
  });

  it('flags a knownUnchecked entry with a whitespace-only reason', () => {
    expect(unreasonedEntries([{ file: 'a.test.ts', reason: '   ' }])).toEqual(['a.test.ts']);
  });

  it('accepts a genuine reason', () => {
    expect(unreasonedEntries([{ file: 'a.test.ts', reason: 'debt, see backlog.md' }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The real repository, right now — one more input to the same functions above, not the only one.
// ---------------------------------------------------------------------------

function testFilesOnDisk(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();
}

function realInclude(): string[] {
  const raw = readFileSync(path.join(TESTS_DIR, 'tsconfig.json'), 'utf8');
  const parsed = JSON.parse(raw) as { include?: unknown };
  if (!Array.isArray(parsed.include)) {
    throw new Error('tests/tsconfig.json: "include" is missing or not an array.');
  }
  return parsed.include as string[];
}

describe('every tests/*.test.ts file is either type-checked or a documented, reasoned exception', () => {
  it('finds at least one test file on disk (a silently empty directory would prove nothing)', () => {
    expect(testFilesOnDisk().length).toBeGreaterThan(0);
  });

  it('every knownUnchecked entry carries a non-empty reason', () => {
    expect(unreasonedEntries(KNOWN_UNCHECKED)).toEqual([]);
  });

  it('every test file on disk is in tsconfig.json include, or KNOWN_UNCHECKED with a reason', () => {
    const missing = uncoveredTestFiles(testFilesOnDisk(), realInclude(), KNOWN_UNCHECKED);
    expect(
      missing,
      `Not type-checked and not declared as known debt: ${missing.join(', ')}. ` +
        `Add each to tests/tsconfig.json's "include", or to KNOWN_UNCHECKED here with a reason.`,
    ).toEqual([]);
  });
});
