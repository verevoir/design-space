/**
 * close-preview-environment.sh is promote.yml's answer to the GITHUB_TOKEN event-suppression
 * defect: `pull_request: closed`, which preview.yml's cleanup job listens for, is never
 * delivered when the merge that produces it was performed as GITHUB_TOKEN — deliberate,
 * documented, and invisible. This script closes the tag and the branch directly instead of
 * depending on that event.
 *
 * Two stubs on PATH, the same "produce the outcome, don't mock the internals" discipline as
 * remove-preview-tag.test.ts: a fake `gcloud` (this script delegates tag removal to
 * remove-preview-tag.sh, which calls gcloud) and a fake `gh` (branch deletion).
 */
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/promote/close-preview-environment.sh');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let stubDir: string | undefined;

afterEach(async () => {
  if (stubDir) {
    await rm(stubDir, { recursive: true, force: true });
    stubDir = undefined;
  }
});

/** Put fake `gcloud` and `gh` binaries on PATH, each printing its own output and exit code. */
async function withStubs(opts: {
  gcloudOutput: string;
  gcloudCode: number;
  ghOutput?: string;
  ghCode?: number;
}): Promise<string> {
  stubDir = await mkdtemp(join(tmpdir(), 'ds-close-preview-stub-'));

  const gcloud = join(stubDir, 'gcloud');
  await writeFile(gcloud, `#!/bin/sh\ncat <<'EOF'\n${opts.gcloudOutput}\nEOF\nexit ${opts.gcloudCode}\n`, 'utf-8');
  await chmod(gcloud, 0o755);

  const gh = join(stubDir, 'gh');
  await writeFile(gh, `#!/bin/sh\ncat <<'EOF'\n${opts.ghOutput ?? ''}\nEOF\nexit ${opts.ghCode ?? 0}\n`, 'utf-8');
  await chmod(gh, 0o755);

  return stubDir;
}

function run(pathPrefix: string): Promise<RunResult> {
  return new Promise((res, rej) => {
    const proc = spawn(
      'bash',
      [SCRIPT, 'design-space-studio', 'europe-west2', 'pr-8', 'verevoir/design-space', '2S.4-promotion-workflow'],
      { env: { ...process.env, PATH: `${pathPrefix}:${process.env['PATH'] ?? ''}` } },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    proc.on('close', (exitCode: number | null) => res({ exitCode: exitCode ?? 1, stdout, stderr }));
    proc.on('error', rej);
  });
}

describe('close-preview-environment.sh', () => {
  it('exits 0 when the tag is removed and the branch is deleted', async () => {
    const dir = await withStubs({ gcloudOutput: 'Traffic updated.', gcloudCode: 0, ghOutput: '', ghCode: 0 });
    const r = await run(dir);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Deleted branch 2S.4-promotion-workflow.');
  });

  it('exits 0 when the tag was already absent and the branch is deleted', async () => {
    const dir = await withStubs({
      gcloudOutput: 'ERROR: (gcloud.run.services.update-traffic) Tag not found: pr-8',
      gcloudCode: 1,
      ghOutput: '',
      ghCode: 0,
    });
    const r = await run(dir);

    expect(r.exitCode).toBe(0);
  });

  it('exits 0 when the tag is removed and the branch was already absent', async () => {
    const dir = await withStubs({
      gcloudOutput: 'Traffic updated.',
      gcloudCode: 0,
      ghOutput:
        'HTTP 422: Reference does not exist (https://api.github.com/repos/verevoir/design-space/git/refs/heads/2S.4-promotion-workflow)',
      ghCode: 1,
    });
    const r = await run(dir);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('already absent');
  });

  it('FAILS with exit 1 when the tag cannot be removed for a real reason, and leaves the branch alone', async () => {
    const dir = await withStubs({
      gcloudOutput: 'ERROR: (gcloud.run.services.update-traffic) PERMISSION_DENIED: caller lacks permission',
      gcloudCode: 1,
      ghOutput: 'should never run',
      ghCode: 0,
    });
    const r = await run(dir);

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('branch was left in place');
    expect(r.stdout).not.toContain('should never run');
  });

  it('FAILS with exit 2 when the branch cannot be deleted for a real reason, even though the tag was handled', async () => {
    const dir = await withStubs({
      gcloudOutput: 'Traffic updated.',
      gcloudCode: 0,
      ghOutput: 'HTTP 403: Resource not accessible by integration',
      ghCode: 1,
    });
    const r = await run(dir);

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('could not be deleted');
  });
});
