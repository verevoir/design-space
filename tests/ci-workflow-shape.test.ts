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

// ---------------------------------------------------------------------------
// Audit step extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract just the YAML block for the npm audit step, from the line containing
 * `run: npm audit` up to (but not including) the next step boundary `      - `.
 * This bounds every audit-step assertion so a property found *elsewhere* in the
 * file cannot satisfy the check.
 */
function extractAuditStepBlock(): string {
  const auditRunIdx = yml.indexOf('run: npm audit');
  if (auditRunIdx < 0) return '';
  // Walk back to the start of this step's `      - ` marker.
  const stepStart = yml.lastIndexOf('\n', auditRunIdx);
  // Find the next step boundary: a line that starts with whitespace + `- ` after
  // the audit line. YAML step separators in this file are `      - `.
  const nextStep = yml.indexOf('\n      - ', auditRunIdx);
  const stepEnd = nextStep >= 0 ? nextStep : yml.length;
  return yml.slice(stepStart, stepEnd);
}

const auditStep = extractAuditStepBlock();

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

// ---------------------------------------------------------------------------
// Audit step — blocking behaviour
//
// The four defeat mechanisms a future edit could apply (each pinned by its own test):
//   1. Appending `|| true` to the audit command — makes the step always exit 0.
//   2. Adding `continue-on-error: true` to the step — the runner skips the step on
//      failure and marks it yellow rather than failing the job.
//   3. Weakening `--audit-level` (to `low`, `moderate`, `critical`, or `none`) —
//      changes which severity bracket triggers a non-zero exit.
//   4. Moving the audit step after other steps — does not directly defeat the gate
//      but buries the security signal and makes it easy to miss; pinned so any
//      reordering of the steps is a deliberate, reviewed change.
//
// Each assertion is scoped to the extracted audit-step block so a property found
// elsewhere in the file cannot accidentally satisfy the check.
// ---------------------------------------------------------------------------

describe('ci.yml — audit step blocks on findings', () => {
  it('audit step is present in ci.yml', () => {
    // Foundation: if the audit step is removed entirely, all scoped assertions
    // below would vacuously pass against an empty string. This guard fails first.
    expect(auditStep).not.toBe('');
  });

  it('runs npm audit with --audit-level=high (not weaker)', () => {
    // The threshold is documented in docs/adr/0006-dependency-vulnerability-threshold.md.
    // `high` triggers a non-zero exit on high and critical findings.
    // Weaker levels (`low`, `moderate`, `critical`, `none`) would widen the window
    // of unflagged vulnerabilities. Pinned here so a well-intentioned bump breaks
    // a test rather than passing silently.
    expect(auditStep).toMatch(/--audit-level=high/);
  });

  it('does not use a weaker audit level in the audit step', () => {
    // Belt-and-suspenders: reject any level weaker than high. `none` suppresses
    // the exit code entirely; `low`/`moderate`/`critical` each lower the bar.
    expect(auditStep).not.toMatch(/--audit-level=(none|low|moderate|critical)/);
  });

  it('does not append || true to the audit step (defeat: always-green exit)', () => {
    // `npm audit --audit-level=high || true` exits 0 regardless of findings.
    // Checks the bounded audit-step block, not the whole file.
    expect(auditStep).not.toContain('|| true');
  });

  it('does not carry continue-on-error: true on the audit step (defeat: skip on failure)', () => {
    // `continue-on-error: true` tells the runner to mark the step as a warning
    // and proceed rather than failing the job — silently defeating the gate.
    expect(auditStep).not.toContain('continue-on-error: true');
  });

  it('audit step appears before npm run lint in the workflow (defeat: reordering)', () => {
    // The audit step must precede the build/test steps so a vulnerability finding
    // stops the job before the more expensive steps run. Pinning the order here
    // makes any reordering a deliberate, reviewed change.
    const auditPos = yml.indexOf('npm audit');
    const lintPos = yml.indexOf('npm run lint');
    expect(auditPos).toBeGreaterThan(0);
    expect(lintPos).toBeGreaterThan(0);
    expect(auditPos).toBeLessThan(lintPos);
  });
});
