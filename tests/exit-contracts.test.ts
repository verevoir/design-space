/**
 * check-exit-contracts.mjs generalises the `testing` finding on rollback.sh: a script whose own
 * doc comment documents a genuine third outcome (a specific code alongside another code or a
 * generic "other" bucket) needs that code asserted precisely, not merely `not.toBe(0)`. A
 * checker that gets this wrong is worse than no checker, so its parser and its verdict are each
 * proven here — the parser against literal strings, the verdict against disposable fixture
 * repositories rather than trusting the doc comment's own description of itself.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  extractDocumentedExitCodes,
  findUnassertedCodes,
  scriptsWithMultiCodeContracts,
  stripCommentMarker,
} from '../scripts/check-exit-contracts.mjs';

// ---------------------------------------------------------------------------
// stripCommentMarker / extractDocumentedExitCodes — the parser itself
// ---------------------------------------------------------------------------

describe('stripCommentMarker', () => {
  it('strips a bash `#` marker', () => {
    expect(stripCommentMarker('#   0  ok')).toBe('0  ok');
  });

  it('strips a JSDoc `*` marker', () => {
    expect(stripCommentMarker(' *   2  pending')).toBe('2  pending');
  });

  it('returns null for a line carrying no comment marker at all', () => {
    expect(stripCommentMarker('set -euo pipefail')).toBeNull();
  });
});

describe('extractDocumentedExitCodes', () => {
  it("extracts every literal code from rollback.sh's own shape (0 / 2 / n)", () => {
    const src = ['#!/usr/bin/env bash', '#', '# Exit status:', '#   0  ok', '#   2  refused', '#   n  (other) incident', 'set -e'].join(
      '\n',
    );
    const { codes, sawGeneric } = extractDocumentedExitCodes(src);
    expect(codes).toEqual([
      { code: 0, description: 'ok' },
      { code: 2, description: 'refused' },
    ]);
    expect(sawGeneric).toBe(true);
  });

  it("extracts codes from checks-green.mjs's JSDoc `*` shape", () => {
    const src = ['/**', ' * Exit status is the verdict:', ' *   0  green', ' *   2  pending', ' *   1  blocked', ' */'].join('\n');
    const { codes, sawGeneric } = extractDocumentedExitCodes(src);
    expect(codes).toEqual([
      { code: 0, description: 'green' },
      { code: 2, description: 'pending' },
      { code: 1, description: 'blocked' },
    ]);
    expect(sawGeneric).toBe(false);
  });

  it('does not treat a bare "n" placeholder as a literal code', () => {
    const { codes, sawGeneric } = extractDocumentedExitCodes(['# Exit status:', '#   0  ok', '#   n  other', 'x'].join('\n'));
    expect(codes.map((c) => c.code)).toEqual([0]);
    expect(sawGeneric).toBe(true);
  });

  it('finds nothing when the script has no "Exit status:" section at all', () => {
    expect(extractDocumentedExitCodes('#!/usr/bin/env bash\necho hi\n').codes).toEqual([]);
  });

  it("does not parse a single-line summary (mutation-check.sh's shape) as a structured list", () => {
    const src = '# Exit status: 0 only if every mutation was RED. Any GREEN or DID-NOT-APPLY exits non-zero.\nset -e';
    expect(extractDocumentedExitCodes(src).codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scriptsWithMultiCodeContracts / findUnassertedCodes — proven against fixture repos
//
// A synthetic git repository each time, not the real one, so these are a genuine mutation-check
// of the checker: a fixture engineered to have the defect must be flagged, and the same fixture
// with the fix applied must be clean.
// ---------------------------------------------------------------------------

let fixtureDir: string | undefined;

afterEach(async () => {
  if (fixtureDir) {
    await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = undefined;
  }
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ds-exit-contract-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

describe('scriptsWithMultiCodeContracts — fixture repos', () => {
  it('flags a script documenting a literal code alongside a generic "other" bucket (3 categories)', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['#!/usr/bin/env bash', '# Exit status:', '#   0  ok', '#   3  refused, an incident', '#   n  other, general failure'].join(
        '\n',
      ),
    });

    expect(scriptsWithMultiCodeContracts(fixtureDir)).toEqual([{ relPath: 'scripts/thing.sh', codes: [{ code: 3, description: 'refused, an incident' }] }]);
  });

  it('does NOT flag a plain binary contract — 0 and a generic "other" only (2 categories)', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   n  (other) incident'].join('\n'),
    });

    expect(scriptsWithMultiCodeContracts(fixtureDir)).toEqual([]);
  });

  it('does NOT flag a plain binary contract — two literal codes, no generic bucket (2 categories)', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   1  it is not'].join('\n'),
    });

    expect(scriptsWithMultiCodeContracts(fixtureDir)).toEqual([]);
  });

  it('ignores an untracked script entirely, even if it has a genuine multi-outcome contract', async () => {
    fixtureDir = await fixtureRepo({});
    // Written AFTER `git add -A`, so it is on disk but not in the index — mirrors this
    // repository's own untracked, throwaway helper scripts, which must never drive this check.
    await mkdir(join(fixtureDir, 'scripts'), { recursive: true });
    await writeFile(
      join(fixtureDir, 'scripts/untracked.sh'),
      ['# Exit status:', '#   0  ok', '#   3  refused', '#   n  other'].join('\n'),
      'utf-8',
    );

    expect(scriptsWithMultiCodeContracts(fixtureDir)).toEqual([]);
  });
});

describe('findUnassertedCodes — fixture repos', () => {
  it('reports the code as unasserted when the test only checks not.toBe(0) — the exact original defect', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   3  refused, an incident', '#   n  other, general failure'].join('\n'),
      'tests/thing.test.ts': "it('refuses', () => { expect(run('thing.sh').code).not.toBe(0); });",
    });

    const findings = findUnassertedCodes(fixtureDir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ script: 'scripts/thing.sh', code: 3 });
  });

  it('is clean once the test asserts the code precisely — the fix', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   3  refused, an incident', '#   n  other, general failure'].join('\n'),
      'tests/thing.test.ts': "it('refuses', () => { expect(run('thing.sh').code).toBe(3); });",
    });

    expect(findUnassertedCodes(fixtureDir)).toEqual([]);
  });

  it('reports "no test file mentions this script at all" when nothing references it', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   3  refused', '#   n  other'].join('\n'),
      'tests/unrelated.test.ts': "it('x', () => { expect(1).toBe(1); });",
    });

    const findings = findUnassertedCodes(fixtureDir);
    expect(findings).toEqual([{ script: 'scripts/thing.sh', code: null, description: 'no test file mentions this script at all' }]);
  });

  it('does not require anything of a plain binary contract, even with only not.toBe(0)', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   1  it is not'].join('\n'),
      'tests/thing.test.ts': "it('x', () => { expect(run('thing.sh').code).not.toBe(0); });",
    });

    expect(findUnassertedCodes(fixtureDir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The real repository, right now
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// main() — the CLI entry point itself, not just the functions it calls.
//
// Every OTHER new CLI script this PR adds (journey-expectations.mjs, traffic-snapshot.mjs) is
// exercised via spawnSync against its own process boundary — proving its exit-code selection
// and its stdout/stderr routing, not just the pure functions underneath. This script's main()
// had none of that: only the exported functions were imported and called directly. Driven here
// the same way, against a fixture repo via the CHECK_EXIT_CONTRACTS_ROOT override main() reads
// — never against the real repository, so this can prove the failing branch too.
// ---------------------------------------------------------------------------

const CHECK_EXIT_CONTRACTS_CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/check-exit-contracts.mjs');

function runCheckExitContractsCli(root: string) {
  const res = spawnSync('node', [CHECK_EXIT_CONTRACTS_CLI], {
    encoding: 'utf-8',
    env: { ...process.env, CHECK_EXIT_CONTRACTS_ROOT: root },
  });
  return { code: res.status ?? 1, out: res.stdout ?? '', err: res.stderr ?? '' };
}

describe('check-exit-contracts.mjs — CLI entry point (main())', () => {
  it('exits 0 and reports clean on stdout when every documented code is precisely asserted', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   3  refused, an incident', '#   n  other, general failure'].join('\n'),
      'tests/thing.test.ts': "it('refuses', () => { expect(run('thing.sh').code).toBe(3); });",
    });

    const r = runCheckExitContractsCli(fixtureDir);

    expect(r.code).toBe(0);
    expect(r.out).toContain('every documented multi-outcome exit contract is precisely asserted');
    expect(r.err).toBe('');
  });

  it('exits 1 and reports the unasserted code on stderr — the exact original rollback.sh defect, reproduced through the CLI boundary', async () => {
    fixtureDir = await fixtureRepo({
      'scripts/thing.sh': ['# Exit status:', '#   0  ok', '#   3  refused, an incident', '#   n  other, general failure'].join('\n'),
      'tests/thing.test.ts': "it('refuses', () => { expect(run('thing.sh').code).not.toBe(0); });",
    });

    const r = runCheckExitContractsCli(fixtureDir);

    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('FAILED');
    expect(r.err).toContain('scripts/thing.sh');
    expect(r.err).toContain('exit 3');
  });

  it('reads its default ROOT — the real repository — when the override is unset, and finds it clean', () => {
    // The one assertion that ties this back to production behaviour: with no env override at
    // all, main() must fall through to the same ROOT the rest of this file already proves is
    // clean (findUnassertedCodes() — the real repository, above).
    const res = spawnSync('node', [CHECK_EXIT_CONTRACTS_CLI], { encoding: 'utf-8' });

    expect(res.status).toBe(0);
  });
});

describe('findUnassertedCodes — the real repository', () => {
  it('reports no findings: rollback.sh\'s exit 2 and checks-green.mjs\'s 0/1/2 are all precisely asserted', () => {
    expect(findUnassertedCodes()).toEqual([]);
  });

  it('confirms rollback.sh and checks-green.mjs are exactly the scripts this repository has with a genuine multi-outcome contract', () => {
    const found = scriptsWithMultiCodeContracts()
      .map((s) => s.relPath)
      .sort();
    expect(found).toEqual(['scripts/promote/checks-green.mjs', 'scripts/promote/rollback.sh']);
  });
});
