import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shape regression tests for ci.yml — the same zero-dependency text-shape approach
// used by workflow-shape.test.ts for the antagonistic-review workflow. The properties
// pinned here are the ones a careless edit would silently drop: pinned action SHAs,
// job timeout, least-privilege permissions, persist-credentials: false, and the audit
// threshold. Regexes match whitespace-collapsed text so YAML line-wrapping never matters.

const yml = readFileSync(
  fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
  'utf8'
);
const flat = yml.replace(/\s+/g, ' ');

describe('ci.yml — action pins', () => {
  it('pins actions/checkout to a 40-character commit SHA, not a floating tag', () => {
    // A floating tag (e.g. @v4) is mutable: the action owner can repoint it at
    // new code, and it runs with the repository token. A SHA pin is immutable.
    expect(flat).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
  });

  it('pins actions/setup-node to a 40-character commit SHA, not a floating tag', () => {
    expect(flat).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/);
  });

  it('has no action reference that uses only a version tag (e.g. @v4)', () => {
    // Belt-and-suspenders: reject any `uses:` line that carries @v<digit> without
    // also carrying a SHA in the same `uses:` field. A SHA pin with a # v4 comment
    // won't match this because the SHA comes immediately after `@`.
    expect(flat).not.toMatch(/uses: [a-z0-9/_-]+@v\d/);
  });
});

describe('ci.yml — job timeout', () => {
  it('declares timeout-minutes on the ci job', () => {
    // Without a timeout a hung checkout or npm registry call would hold the runner
    // until the repository-wide 6-hour ceiling.
    expect(flat).toMatch(/timeout-minutes: \d+/);
  });

  it('sets the timeout to a finite, sensible value (≤ 60)', () => {
    // Catches the degenerate case of `timeout-minutes: 360` which satisfies the
    // structural presence check but provides no real bound.
    const m = flat.match(/timeout-minutes: (\d+)/);
    expect(m).not.toBeNull();
    const minutes = parseInt(m![1], 10);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(60);
  });
});

describe('ci.yml — least-privilege permissions', () => {
  it('declares a top-level permissions block', () => {
    // Without a permissions block the job inherits the repository default, which
    // is full read/write on every scope the token can reach.
    expect(yml).toContain('permissions:');
  });

  it('grants contents: read', () => {
    // Reading code is the one permission this workflow needs.
    expect(flat).toMatch(/permissions: .*contents: read/);
  });

  it('does not grant write on any scope', () => {
    // No scope should be `write`; `read` or absent is the only acceptable value.
    // This catches a future addition that carelessly widens the token.
    expect(flat).not.toMatch(/:\s*write/);
  });

  it('does not grant pull-requests: write', () => {
    // Belt-and-suspenders for the most dangerous common addition: posting PR comments
    // or merging via the token on a public repo.
    expect(flat).not.toMatch(/pull-requests: write/);
  });
});

describe('ci.yml — persist-credentials: false', () => {
  it('sets persist-credentials: false on the checkout step', () => {
    // This is a public repo; PRs execute untrusted code via `npm ci` and `npm test`.
    // Without this the GITHUB_TOKEN is left in .git/config and is readable by that
    // code. persist-credentials: false drops it before subsequent steps run.
    const checkoutAt = yml.indexOf('actions/checkout@');
    expect(checkoutAt).toBeGreaterThanOrEqual(0);
    // The setting must appear in the same step block — slice to the next `- uses:`
    // or `- run:` boundary so an occurrence elsewhere cannot satisfy the assertion.
    const nextStepAt = yml.indexOf('\n      - ', checkoutAt + 1);
    const checkoutStep = nextStepAt >= 0 ? yml.slice(checkoutAt, nextStepAt) : yml.slice(checkoutAt);
    expect(checkoutStep).toContain('persist-credentials: false');
  });
});

describe('ci.yml — audit step', () => {
  it('runs npm audit with --audit-level=high', () => {
    // The threshold is documented in docs/adr/0006-dependency-vulnerability-threshold.md.
    // Pinned here so a well-intentioned bump to `moderate` or a drop to `critical`
    // (or a removal) breaks a test rather than passing silently.
    expect(flat).toMatch(/run: npm audit --audit-level=high/);
  });

  it('does not run npm audit in report-only mode (no --json without a blocking exit)', () => {
    // A report-only audit that never fails is not a gate. The step must emit a
    // non-zero exit on findings above the threshold; a pure `--json` flag with no
    // follow-on check would suppress that.
    // (A false positive here is acceptable; the important direction is no silent pass.)
    const auditLine = flat.match(/run: npm audit[^;]*/)?.[0] ?? '';
    expect(auditLine).not.toMatch(/--json(?!.*&&.*exit)/);
  });
});
