/**
 * Guard against the class of defect that broke PR #11's `deploy` check: tsconfig.json gained a
 * project reference to `tests` (so tests/aigency-config.test.ts is type-checked as part of the
 * build) and the Dockerfile's builder stage was never told about it. `tsc -b` resolves the
 * reference fine against a full checkout — build/test both pass locally and in CI's
 * full-checkout gates — but inside the Docker build only packages/ and examples/ were COPY'd,
 * so `tsc -b` failed with TS5083: Cannot read file '/app/tests/tsconfig.json'.
 *
 * This is the second occurrence of the same class tests/dockerfile-runtime-deps.test.ts closes
 * for the runtime stage (story 2.2 added a new @design-space/* import and the runtime COPY list
 * was not updated). That test derives the reachable-package set by walking imports; this one
 * derives the reference set by reading tsconfig.json's own `references` array, and checks each
 * one's top-level directory is COPY'd into the builder stage as a real source tree — not merely
 * as a package.json, which the early npm-ci-caching COPYs already do for every package.
 *
 * Deliberately NOT a hardcoded list on either side — a hardcoded list is the Dockerfile's or
 * tsconfig.json's own enumeration written a second time, and would have passed happily the day
 * this broke.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface TsconfigReference {
  path?: unknown;
}
interface TsconfigShape {
  references?: TsconfigReference[];
}

// ---------------------------------------------------------------------------
// Pure logic — proven against fixtures rather than only this repository's own, already-correct
// files. See tests/aigency-config.test.ts's file header ("THE RULE EVERY TEST BELOW FOLLOWS")
// for why that matters generally; specifically here, the real config's references have always
// been copied by the time either function runs against them for real, so a gutted predicate
// would look identical on that one input.
// ---------------------------------------------------------------------------

/**
 * Every project reference's TOP-LEVEL directory segment — `packages/journey-model` and
 * `packages/render` both fold to `packages`, `tests` stays `tests`. What the Dockerfile
 * actually needs to COPY is the top-level directory; `tsc -b` walks from there.
 */
export function topLevelDirsFromReferences(config: TsconfigShape): Set<string> {
  const dirs = new Set<string>();
  for (const ref of config.references ?? []) {
    if (typeof ref.path !== 'string' || ref.path.length === 0) continue;
    dirs.add(ref.path.split('/')[0]!);
  }
  return dirs;
}

/**
 * Which of `dirs` has no full-directory COPY (`COPY <dir>/ <dir>/`) in `builderSection`. A
 * COPY of a single file inside the directory (e.g. a per-package `package.json`, used earlier
 * in the builder stage to cache `npm ci`) does NOT satisfy this — the builder needs the actual
 * source tree tsc reads, not just a manifest.
 */
export function findUncopiedDirs(builderSection: string, dirs: Set<string>): string[] {
  const missing: string[] = [];
  for (const dir of dirs) {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^COPY\\s+${escaped}/\\s+${escaped}/\\s*$`, 'm');
    if (!re.test(builderSection)) missing.push(dir);
  }
  return missing.sort();
}

describe('topLevelDirsFromReferences', () => {
  it('folds every nested package reference to its shared top-level directory', () => {
    expect(
      topLevelDirsFromReferences({
        references: [{ path: 'packages/journey-model' }, { path: 'packages/render' }],
      }),
    ).toEqual(new Set(['packages']));
  });

  it('keeps a top-level-only reference (no nested path) as itself', () => {
    expect(topLevelDirsFromReferences({ references: [{ path: 'tests' }] })).toEqual(
      new Set(['tests']),
    );
  });

  it('returns an empty set when there are no references at all', () => {
    expect(topLevelDirsFromReferences({})).toEqual(new Set());
    expect(topLevelDirsFromReferences({ references: [] })).toEqual(new Set());
  });

  it('ignores a malformed reference entry rather than throwing', () => {
    expect(topLevelDirsFromReferences({ references: [{}, { path: 42 as unknown as string }] })).toEqual(
      new Set(),
    );
  });
});

describe('findUncopiedDirs', () => {
  it('flags a referenced directory with no COPY line at all — the exact original defect', () => {
    expect(findUncopiedDirs('COPY packages/ packages/\n', new Set(['packages', 'tests']))).toEqual([
      'tests',
    ]);
  });

  it('accepts a full-directory COPY as satisfying the requirement — the fix', () => {
    expect(
      findUncopiedDirs('COPY packages/ packages/\nCOPY tests/ tests/\n', new Set(['packages', 'tests'])),
    ).toEqual([]);
  });

  it('does not accept a manifest-only COPY as satisfying the requirement', () => {
    expect(findUncopiedDirs('COPY tests/package.json tests/\n', new Set(['tests']))).toEqual(['tests']);
  });

  it('reports every missing directory, not just the first', () => {
    expect(findUncopiedDirs('', new Set(['packages', 'tests', 'examples']))).toEqual([
      'examples',
      'packages',
      'tests',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The real repository, right now — one more input to the same functions above, not the only one.
// ---------------------------------------------------------------------------

function builderStageSection(): string {
  const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf-8');
  const startIdx = dockerfile.indexOf('AS builder');
  if (startIdx === -1) {
    throw new Error('Dockerfile: could not find the builder stage (no "AS builder" marker).');
  }
  const endIdx = dockerfile.indexOf('AS runtime', startIdx);
  if (endIdx === -1) {
    throw new Error('Dockerfile: could not find the runtime stage marker to bound the builder stage.');
  }
  return dockerfile.slice(startIdx, endIdx);
}

function rootTsconfig(): TsconfigShape {
  const raw = readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf-8');
  return JSON.parse(raw) as TsconfigShape;
}

describe('Dockerfile builder stage carries every directory tsconfig.json references', () => {
  it('tsconfig.json declares at least one project reference (a silently empty set would prove nothing)', () => {
    expect(topLevelDirsFromReferences(rootTsconfig()).size).toBeGreaterThan(0);
  });

  it('copies every referenced top-level directory into the builder stage', () => {
    const dirs = topLevelDirsFromReferences(rootTsconfig());
    const missing = findUncopiedDirs(builderStageSection(), dirs);
    expect(
      missing,
      `Dockerfile builder stage is missing a full-directory COPY for: ${missing.join(', ')}. ` +
        `tsconfig.json references: ${[...dirs].sort().join(', ')}.`,
    ).toEqual([]);
  });
});
