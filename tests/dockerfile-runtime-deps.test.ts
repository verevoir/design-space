/**
 * Guard against the class of defect that broke PR #10's `deploy` check: the Dockerfile's
 * runtime stage COPYs packages by hand, and nothing forced it to be told about a new one.
 * `story-2.2` added `@design-space/adapter-contract`, made `render` depend on it, and the
 * runtime image was never updated — the container built, pushed, and then died on startup
 * because `render`'s compiled output required a package that was not there.
 *
 * This test derives, by actually walking value imports (never type-only ones — those are
 * erased by the compiler and leave nothing to `require` at runtime) from
 * `packages/studio/src/serve.ts`, the full set of `@design-space/*` packages the running
 * container can reach, and asserts every one of them is copied into the Dockerfile's runtime
 * stage. It is deliberately NOT a hardcoded list — a hardcoded list is the Dockerfile's own
 * enumeration written a second time, and would have passed happily the night this broke.
 *
 * Branch-agnostic by construction: on this branch the reachable set has no
 * `adapter-contract` and the assertion passes as things stand. On `story-2.2` the reachable
 * set includes it, and this test fails until the Dockerfile is fixed — which is the point.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------

/** Strips block and line comments so a comment mentioning an import cannot be read as one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every module specifier this source has a RUNTIME edge to — from `import ... from` and
 * `export ... from` (re-exports load their source module exactly like imports do). A
 * specifier is excluded when the whole declaration is `type`-only, or when every named
 * specifier in a brace clause carries an inline `type` — both are erased by the compiler and
 * create nothing for Node to resolve. A clause with at least one real binding is a real edge,
 * even sitting next to typed ones in the same statement.
 *
 * Known limitation, stated rather than hidden: a combined default-plus-named clause
 * (`import Default, { a, b } from 'x'`) is not specially handled and would silently produce
 * no edge. No such form exists in any file this walker actually visits (checked by hand), but
 * it is a real blind spot if that style is ever introduced upstream of `serve.ts`.
 */
export function extractEdges(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const edges: string[] = [];

  const BRACE_RE = /(?:import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = BRACE_RE.exec(source))) {
    const wholeTypeOnly = Boolean(m[1]);
    const specifiers = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const hasRealBinding = !wholeTypeOnly && specifiers.some((s) => !/^type\s+/.test(s));
    if (hasRealBinding) edges.push(m[3]);
  }

  const PLAIN_RE = /(?:import|export)\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = PLAIN_RE.exec(source))) {
    const wholeTypeOnly = Boolean(m[1]);
    if (!wholeTypeOnly) edges.push(m[2]);
  }

  return edges;
}

function packageDirFromSpecifier(spec: string): string | null {
  const m = /^@design-space\/([a-z0-9-]+)$/.exec(spec);
  return m ? m[1] : null;
}

function resolveRelative(fromAbsFile: string, spec: string): string {
  const dir = path.dirname(fromAbsFile);
  let resolved = path.normalize(path.join(dir, spec));
  if (resolved.endsWith('.js')) resolved = resolved.slice(0, -3) + '.ts';
  else if (!resolved.endsWith('.ts')) resolved = resolved + '.ts';
  return resolved;
}

/** Every `@design-space/*` package reachable from `serve.ts` by a real, runtime edge. */
export function deriveReachablePackages(): Set<string> {
  const visitedFiles = new Set<string>();
  const reachablePackages = new Set<string>();

  function visit(absFile: string): void {
    if (visitedFiles.has(absFile)) return;
    visitedFiles.add(absFile);
    if (!existsSync(absFile)) {
      throw new Error(
        `dockerfile-runtime-deps walker: expected to find ${absFile} but it does not exist — ` +
          'either the walker resolved a path wrongly, or a package entry point moved.',
      );
    }
    const source = readFileSync(absFile, 'utf-8');
    for (const specifier of extractEdges(source)) {
      if (specifier.startsWith('.')) {
        visit(resolveRelative(absFile, specifier));
        continue;
      }
      const pkg = packageDirFromSpecifier(specifier);
      if (pkg) {
        reachablePackages.add(pkg);
        visit(path.join(REPO_ROOT, 'packages', pkg, 'src', 'index.ts'));
      }
      // Anything else is an external npm package or a node: builtin — the lockfile and
      // `npm ci --omit=dev` cover it; it is not one of the Dockerfile's per-package COPY lines.
    }
  }

  visit(path.join(REPO_ROOT, 'packages', 'studio', 'src', 'serve.ts'));
  return reachablePackages;
}

function runtimeStageSection(): string {
  const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf-8');
  const idx = dockerfile.indexOf('AS runtime');
  if (idx === -1) {
    throw new Error('Dockerfile: could not find the runtime stage (no "AS runtime" marker).');
  }
  return dockerfile.slice(idx);
}

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------

describe('Dockerfile runtime stage carries every package serve.ts can reach at runtime', () => {
  const reachable = deriveReachablePackages();

  it('the walker found at least one reachable package (a silently empty set would prove nothing)', () => {
    expect(reachable.size).toBeGreaterThan(0);
  });

  it("copies each reachable package's manifest and compiled output into the runtime stage", () => {
    const section = runtimeStageSection();
    const missing: string[] = [];
    for (const pkg of reachable) {
      const hasManifest = new RegExp(`packages/${pkg}/package\\.json`).test(section);
      const hasDist = new RegExp(`packages/${pkg}/dist\\b`).test(section);
      if (!hasManifest || !hasDist) missing.push(pkg);
    }
    expect(
      missing,
      `Dockerfile runtime stage is missing: ${missing.join(', ')}. Reachable from serve.ts by ` +
        `a real (non-type-only) import chain: ${[...reachable].sort().join(', ')}.`,
    ).toEqual([]);
  });
});

describe('the walker distinguishes real bindings from type-only ones', () => {
  it('a whole-declaration type-only import creates no edge', () => {
    expect(extractEdges("import type { Foo } from '@design-space/foo';")).toEqual([]);
  });

  it('an import whose every named specifier is inline-typed creates no edge', () => {
    expect(extractEdges("import { type Foo, type Bar } from '@design-space/foo';")).toEqual([]);
  });

  it('a mixed import — one typed specifier, one real one — still creates an edge', () => {
    expect(extractEdges("import { type Foo, real } from '@design-space/foo';")).toEqual([
      '@design-space/foo',
    ]);
  });

  it('a type-only re-export creates no edge', () => {
    expect(extractEdges("export type { Foo } from '@design-space/foo';")).toEqual([]);
  });

  it('a re-export with at least one real binding creates an edge, even beside typed ones', () => {
    expect(extractEdges("export { type Foo, real } from '@design-space/foo';")).toEqual([
      '@design-space/foo',
    ]);
  });

  // The PLAIN_RE branch — default and namespace imports, as opposed to the brace-clause form
  // every test above exercises. Previously reachable in the walker but exercised by no test at
  // all, direct or indirect: serve.ts's own @design-space/* imports are brace-only (see the
  // file header), so even the real-tree walk never touched this branch. Distinct from the
  // walker's OWN declared blind spot (a combined `import Default, { a, b } from 'x'` clause,
  // documented above and left unhandled on purpose) — this is a plain default/namespace form,
  // which the code already handles; it simply had no test proving so.

  it('a whole-declaration default import creates a real edge', () => {
    expect(extractEdges("import Default from '@design-space/foo';")).toEqual(['@design-space/foo']);
  });

  it('a whole-declaration type-only default import creates no edge', () => {
    expect(extractEdges("import type Default from '@design-space/foo';")).toEqual([]);
  });

  it('a namespace import creates a real edge', () => {
    expect(extractEdges("import * as ns from '@design-space/foo';")).toEqual(['@design-space/foo']);
  });

  it('a type-only namespace import creates no edge', () => {
    expect(extractEdges("import type * as ns from '@design-space/foo';")).toEqual([]);
  });

  // This is the same assertion made against the real tree rather than a synthetic string: if
  // the walker folded type-only imports in, it would demand `gate` and `pipeline` be copied
  // into the runtime image, which architecture.md states they deliberately are not, because
  // `serve.ts` never imports either of them for a value.
  it('does not fold gate or pipeline into the reachable set, confirming no over-approximation', () => {
    expect(reachableForSanity().has('gate')).toBe(false);
    expect(reachableForSanity().has('pipeline')).toBe(false);
  });
});

function reachableForSanity(): Set<string> {
  return deriveReachablePackages();
}
