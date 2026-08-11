/**
 * Verifies that the no-restricted-imports ESLint rule mechanically blocks deep imports
 * across @design-space/* packages.
 *
 * The test runs ESLint programmatically on a source string that contains a deep import
 * and asserts that a violation is reported. If the rule is removed from eslint.config.js,
 * ESLint reports zero messages and this test goes red.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../');

describe('deep-import boundary rule', () => {
  it('reports a violation when a file imports from a deep path inside a @design-space package', async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      // Run as a virtual file so no real file is needed on disk.
      overrideConfigFile: path.join(repoRoot, 'eslint.config.js'),
    });

    const results = await eslint.lintText(
      // A module that performs a deep import — bypassing the declared public entry point.
      "import { something } from '@design-space/port/src/internal.js';\n",
      { filePath: path.join(repoRoot, 'packages/studio/src/virtual-fixture.ts') },
    );

    const messages = results.flatMap((r) => r.messages);
    const violations = messages.filter((m) => m.ruleId === 'no-restricted-imports');

    expect(
      violations,
      'Expected at least one no-restricted-imports violation for the deep import. ' +
        'If this assertion fails, check that the rule is present in eslint.config.js.',
    ).toHaveLength(1);

    expect(violations[0]?.message).toContain('@design-space');
  });

  it('does not flag a clean import from a package root', async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, 'eslint.config.js'),
    });

    const results = await eslint.lintText(
      "import { PACKAGE_NAME } from '@design-space/port';\n",
      { filePath: path.join(repoRoot, 'packages/studio/src/virtual-fixture.ts') },
    );

    const messages = results.flatMap((r) => r.messages);
    const violations = messages.filter((m) => m.ruleId === 'no-restricted-imports');

    expect(
      violations,
      'A clean root import should not be flagged by no-restricted-imports.',
    ).toHaveLength(0);
  });
});
