/**
 * Guard against a third occurrence of the class dockerfile-project-references.test.ts and
 * dockerfile-runtime-deps.test.ts already close for tsconfig.json's `references` and
 * serve.ts's runtime import graph: a directory the Docker builder stage never COPY's, reached
 * by something the build now actually resolves.
 *
 * This is not either of those. tsconfig.json's `references` array never names `scripts/` — a
 * test file importing a `.mjs` script is not a project reference at all, it is a plain relative
 * import inside tests/tsconfig.json's own `include` list, resolved by `tsc -b` while
 * type-checking the tests project. Adding `exit-contracts.test.ts`, `service-urls.test.ts` and
 * `upsert-preview-comment.test.ts` to `include` is what first made `../scripts/*.mjs` — and the
 * `scripts/*.d.mts` declarations beside them — something the Docker build actually reaches, and
 * the Dockerfile's `COPY scripts/ scripts/` line went in by hand alongside that change with no
 * guard proving the pairing holds going forward.
 *
 * Derived, not hardcoded, and one hop only: for every file named in tests/tsconfig.json's
 * `include`, read its relative (`.`-prefixed) import specifiers and resolve each to the
 * top-level directory it lands in. That is the exact set `tsc -b` needs on disk to resolve
 * those files, whether the import is a value or a type — TypeScript must resolve a module
 * specifier to type-check it even when nothing survives to runtime, so (unlike
 * dockerfile-runtime-deps.test.ts's walker, which exists to answer a different question — what
 * a compiled server actually `require`s) this one does not filter type-only imports out. It
 * does not walk further than one hop from each included file — a general reachable-through-any-
 * import walker across the whole project is a larger, separate piece of work (see the two
 * siblings above, which already do most of it from different seeds) and not what this specific
 * dependency needs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');

/** Strips block and line comments so a comment mentioning a path cannot be read as an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ---------------------------------------------------------------------------
// Pure logic — proven against fixtures rather than only this repository's own, already-correct
// files. See tests/aigency-config.test.ts's file header ("THE RULE EVERY TEST BELOW FOLLOWS")
// for why that matters generally.
// ---------------------------------------------------------------------------

/**
 * Every relative import specifier a file has an edge to — brace, default/namespace, and
 * side-effect-only forms, `import` and `export ... from` alike. Deliberately NOT filtered by
 * `type`: unlike a runtime-reachability walker, this one answers "what must be on disk for
 * `tsc -b` to resolve this file", and a type-only import still requires that.
 */
export function relativeImportSpecifiers(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const specifiers: string[] = [];

  const BRACE_RE = /(?:import|export)\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = BRACE_RE.exec(source))) specifiers.push(m[1]!);

  const PLAIN_RE = /(?:import|export)\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = PLAIN_RE.exec(source))) specifiers.push(m[1]!);

  const SIDE_EFFECT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((m = SIDE_EFFECT_RE.exec(source))) specifiers.push(m[1]!);

  return specifiers.filter((s) => s.startsWith('.'));
}

/**
 * Resolves a relative specifier imported from `fromFileRelToRoot` (e.g. `tests/foo.test.ts`) to
 * the top-level directory, relative to the repo root, it lands in — `scripts` for
 * `../scripts/x.mjs` imported from `tests/foo.test.ts`, `tests` for `./helper` imported from
 * the same file.
 */
export function topLevelDirOfImport(fromFileRelToRoot: string, specifier: string): string {
  const fromDir = path.posix.dirname(fromFileRelToRoot);
  const resolved = path.posix.normalize(path.posix.join(fromDir, specifier));
  return resolved.split('/')[0]!;
}

/**
 * Every top-level directory required on disk for `tsc -b` to resolve the relative imports of
 * every file named in `includedFiles`, given each file's raw source keyed by its bare filename.
 * A file named in `includedFiles` with no entry in `sourceByFile` is skipped rather than
 * thrown on, so a caller can pass a partial fixture without every included name resolving.
 */
export function requiredTopLevelDirs(
  includedFiles: string[],
  sourceByFile: Record<string, string>,
): Set<string> {
  const dirs = new Set<string>();
  for (const file of includedFiles) {
    const source = sourceByFile[file];
    if (source === undefined) continue;
    for (const spec of relativeImportSpecifiers(source)) {
      dirs.add(topLevelDirOfImport(`tests/${file}`, spec));
    }
  }
  return dirs;
}

/** Which of `dirs` has no full-directory COPY (`COPY <dir>/ <dir>/`) in `builderSection`. */
export function findUncopiedDirs(builderSection: string, dirs: Set<string>): string[] {
  const missing: string[] = [];
  for (const dir of dirs) {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^COPY\\s+${escaped}/\\s+${escaped}/\\s*$`, 'm');
    if (!re.test(builderSection)) missing.push(dir);
  }
  return missing.sort();
}

/**
 * Pure: parses raw tsconfig.json text and returns its `include` array, or throws if `include`
 * is absent or not an array. Split out from realIncludeList() below so the error branch can be
 * fixture-tested without needing a malformed file on disk.
 */
export function parseIncludeList(raw: string): string[] {
  const parsed = JSON.parse(raw) as { include?: unknown };
  if (!Array.isArray(parsed.include)) {
    throw new Error('tests/tsconfig.json: "include" is missing or not an array.');
  }
  return parsed.include as string[];
}

/**
 * Pure: extracts the text between the "AS builder" and "AS runtime" markers from raw Dockerfile
 * text, or throws if either marker is absent. Split out from builderStageSection() below so
 * both error branches can be fixture-tested without editing the real Dockerfile.
 */
export function extractBuilderStageSection(dockerfileContent: string): string {
  const startIdx = dockerfileContent.indexOf('AS builder');
  if (startIdx === -1) {
    throw new Error('Dockerfile: could not find the builder stage (no "AS builder" marker).');
  }
  const endIdx = dockerfileContent.indexOf('AS runtime', startIdx);
  if (endIdx === -1) {
    throw new Error('Dockerfile: could not find the runtime stage marker to bound the builder stage.');
  }
  return dockerfileContent.slice(startIdx, endIdx);
}

describe('relativeImportSpecifiers', () => {
  it('extracts a brace-clause relative import', () => {
    expect(relativeImportSpecifiers("import { x } from '../scripts/x.mjs';")).toEqual([
      '../scripts/x.mjs',
    ]);
  });

  it('extracts a type-only relative import — tsc still has to resolve it', () => {
    expect(relativeImportSpecifiers("import type { X } from '../scripts/x.d.mts';")).toEqual([
      '../scripts/x.d.mts',
    ]);
  });

  it('extracts a default import', () => {
    expect(relativeImportSpecifiers("import Default from '../scripts/x.mjs';")).toEqual([
      '../scripts/x.mjs',
    ]);
  });

  it('extracts a namespace import', () => {
    expect(relativeImportSpecifiers("import * as ns from '../scripts/x.mjs';")).toEqual([
      '../scripts/x.mjs',
    ]);
  });

  it('extracts a side-effect-only import', () => {
    expect(relativeImportSpecifiers("import '../scripts/x.mjs';")).toEqual(['../scripts/x.mjs']);
  });

  it('ignores a bare-package import — nothing on disk for the Dockerfile to COPY per-file', () => {
    expect(relativeImportSpecifiers("import { describe } from 'vitest';")).toEqual([]);
  });

  it('ignores a path mentioned only in a comment', () => {
    expect(relativeImportSpecifiers('// see ../scripts/x.mjs for the real thing')).toEqual([]);
  });

  it('reports every relative specifier, not just the first', () => {
    expect(
      relativeImportSpecifiers(
        "import { a } from '../scripts/a.mjs';\nimport { b } from '../scripts/b.mjs';",
      ),
    ).toEqual(['../scripts/a.mjs', '../scripts/b.mjs']);
  });

  it('extracts an export-from relative specifier', () => {
    expect(relativeImportSpecifiers("export { x } from '../scripts/x.mjs';")).toEqual([
      '../scripts/x.mjs',
    ]);
  });

  it('ignores an import-like string inside a block comment — proves the false positive the stripping exists to prevent does not occur', () => {
    expect(
      relativeImportSpecifiers(
        "/* import { x } from '../scripts/x.mjs'; */\nimport { describe } from 'vitest';",
      ),
    ).toEqual([]);
  });
});

describe('topLevelDirOfImport', () => {
  it('resolves a parent-directory specifier to the sibling top-level directory', () => {
    expect(topLevelDirOfImport('tests/foo.test.ts', '../scripts/x.mjs')).toBe('scripts');
  });

  it('resolves a same-directory specifier back to its own top-level directory', () => {
    expect(topLevelDirOfImport('tests/foo.test.ts', './helper')).toBe('tests');
  });
});

describe('requiredTopLevelDirs', () => {
  it('collects the directory of every included file with a relative import', () => {
    expect(
      requiredTopLevelDirs(['a.test.ts', 'b.test.ts'], {
        'a.test.ts': "import { x } from '../scripts/x.mjs';",
        'b.test.ts': "import { y } from '../docs/y.ts';",
      }),
    ).toEqual(new Set(['scripts', 'docs']));
  });

  it('is empty when no included file has a relative import', () => {
    expect(
      requiredTopLevelDirs(['a.test.ts'], { 'a.test.ts': "import { describe } from 'vitest';" }),
    ).toEqual(new Set());
  });

  it('skips an included name with no source provided rather than throwing', () => {
    expect(requiredTopLevelDirs(['ghost.test.ts'], {})).toEqual(new Set());
  });
});

describe('findUncopiedDirs', () => {
  it('flags a required directory with no COPY line at all', () => {
    expect(findUncopiedDirs('COPY tests/ tests/\n', new Set(['scripts']))).toEqual(['scripts']);
  });

  it('accepts a full-directory COPY as satisfying the requirement', () => {
    expect(findUncopiedDirs('COPY scripts/ scripts/\n', new Set(['scripts']))).toEqual([]);
  });

  it('does not accept a manifest-only COPY as satisfying the requirement', () => {
    expect(
      findUncopiedDirs('COPY scripts/service-urls.mjs scripts/\n', new Set(['scripts'])),
    ).toEqual(['scripts']);
  });
});

describe('parseIncludeList', () => {
  it('throws when include is absent', () => {
    expect(() => parseIncludeList('{}')).toThrow(
      'tests/tsconfig.json: "include" is missing or not an array.',
    );
  });

  it('throws when include is present but not an array', () => {
    expect(() => parseIncludeList('{"include": "foo.ts"}')).toThrow(
      'tests/tsconfig.json: "include" is missing or not an array.',
    );
  });

  it('returns the include array on the happy path', () => {
    expect(parseIncludeList('{"include": ["a.test.ts"]}')).toEqual(['a.test.ts']);
  });
});

describe('extractBuilderStageSection', () => {
  it('throws when the builder stage marker is absent', () => {
    expect(() => extractBuilderStageSection('FROM node:20 AS runtime\n')).toThrow(
      'Dockerfile: could not find the builder stage (no "AS builder" marker).',
    );
  });

  it('throws when the runtime stage marker is absent', () => {
    expect(() => extractBuilderStageSection('FROM node:20 AS builder\nCOPY . .\n')).toThrow(
      'Dockerfile: could not find the runtime stage marker to bound the builder stage.',
    );
  });

  it('extracts the section between the two markers on the happy path', () => {
    // The slice runs up to (not including) "AS runtime" itself, so it still carries whatever
    // precedes that marker on its own line ("FROM node:20 " here) — exactly what
    // findUncopiedDirs's COPY-line regex needs present, since a COPY line always sits before
    // the next FROM.
    expect(
      extractBuilderStageSection(
        'FROM node:20 AS builder\nCOPY scripts/ scripts/\nFROM node:20 AS runtime\n',
      ),
    ).toBe('AS builder\nCOPY scripts/ scripts/\nFROM node:20 ');
  });
});

// ---------------------------------------------------------------------------
// The real repository, right now — one more input to the same functions above, not the only one.
// ---------------------------------------------------------------------------

function realIncludeList(): string[] {
  const raw = readFileSync(path.join(TESTS_DIR, 'tsconfig.json'), 'utf8');
  return parseIncludeList(raw);
}

function realSourceByFile(includedFiles: string[]): Record<string, string> {
  const disk = new Set(readdirSync(TESTS_DIR));
  const out: Record<string, string> = {};
  for (const file of includedFiles) {
    if (!disk.has(file)) continue;
    out[file] = readFileSync(path.join(TESTS_DIR, file), 'utf8');
  }
  return out;
}

function builderStageSection(): string {
  const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf-8');
  return extractBuilderStageSection(dockerfile);
}

/**
 * This guard's own file is excluded from the set it scans below. Not a fudge: its real imports
 * (node:fs, node:path, node:url, vitest — see the top of this file) are all bare package or
 * builtin specifiers, nothing relative, so it has nothing here to check — and the test below
 * enforces that this stays true rather than trusting the comment. Without the exclusion the
 * guard finds ITSELF: the fixture strings above, written as example input for the unit tests
 * (`'../scripts/x.mjs'`, `'../docs/y.ts'`), contain relative-looking import text that the
 * regex-based extractor — which scans raw text, not parsed syntax — cannot tell apart from a
 * real import once this file is itself in tests/tsconfig.json's `include`. That is exactly the
 * failure this exclusion exists to prevent, discovered by running the guard against itself.
 *
 * General limitation, stated rather than hidden, in the same spirit as
 * dockerfile-runtime-deps.test.ts's own accepted blind spots (see its header): any INCLUDED
 * file carrying an import-like string outside a `//` or block comment — a fixture, a docstring
 * example, a template literal — will be misread as a real import by this regex extractor.
 * Today only this file does that, and it is named out below. A future included file doing the
 * same would not be caught by anything here; it would surface as a false-positive "missing
 * COPY" failure (loud, not silent), but it is a known, bounded gap, not a solved one. A
 * parser-based extractor would close it properly — a larger piece of work than this specific
 * dependency needs today (see the file header on scope).
 */
const SELF_FILE = 'dockerfile-checked-imports.test.ts';

describe('Dockerfile builder stage carries every directory a type-checked test file imports from', () => {
  it('at least one included test file has a relative import (a silently empty set would prove nothing)', () => {
    const includedFiles = realIncludeList().filter((f) => f !== SELF_FILE);
    const dirs = requiredTopLevelDirs(includedFiles, realSourceByFile(includedFiles));
    expect(dirs.size).toBeGreaterThan(0);
  });

  it('copies every such directory into the builder stage', () => {
    const includedFiles = realIncludeList().filter((f) => f !== SELF_FILE);
    const dirs = requiredTopLevelDirs(includedFiles, realSourceByFile(includedFiles));
    const missing = findUncopiedDirs(builderStageSection(), dirs);
    expect(
      missing,
      `Dockerfile builder stage is missing a full-directory COPY for: ${missing.join(', ')}. ` +
        `Required by a relative import from a tests/tsconfig.json "include" file: ${[...dirs]
          .sort()
          .join(', ')}.`,
    ).toEqual([]);
  });

  it("the guard's own file has no relative import specifiers, so excluding it above is honest rather than a hole that can silently go stale", () => {
    const ownSource = readFileSync(path.join(TESTS_DIR, SELF_FILE), 'utf8');
    // Scan only the real code above the fixtures — the unit-test describe blocks below
    // deliberately contain relative-looking import TEXT as sample input, which is not a real
    // import and would make this assertion fail for the wrong reason if included.
    const firstDescribeIdx = ownSource.indexOf("describe('relativeImportSpecifiers'");
    const realCodeSection = firstDescribeIdx === -1 ? ownSource : ownSource.slice(0, firstDescribeIdx);
    expect(relativeImportSpecifiers(realCodeSection)).toEqual([]);
  });
});
