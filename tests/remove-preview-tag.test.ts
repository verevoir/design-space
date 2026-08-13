/**
 * The cleanup step decides whether a failed `gcloud run services update-traffic --remove-tags`
 * is tolerable. Getting that wrong in either direction is expensive: too permissive and a real
 * fault reports success while the tag keeps routing; too strict and every re-run of a closed PR
 * fails on a tag that is simply already gone.
 *
 * The three branches are driven here against a STUB `gcloud` placed ahead of the real one on
 * PATH, so each outcome is produced rather than simulated by mocking the script's internals.
 */
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/remove-preview-tag.sh');

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

/** Put a fake `gcloud` on PATH that prints `output` and exits with `code`. */
async function withStubGcloud(output: string, code: number): Promise<string> {
  stubDir = await mkdtemp(join(tmpdir(), 'ds-gcloud-stub-'));
  const stub = join(stubDir, 'gcloud');
  await writeFile(stub, `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\nexit ${code}\n`, 'utf-8');
  await chmod(stub, 0o755);
  return stubDir;
}

function run(pathPrefix: string): Promise<RunResult> {
  return new Promise((res, rej) => {
    const proc = spawn('bash', [SCRIPT, 'design-space-studio', 'europe-west2', 'pr-99'], {
      env: { ...process.env, PATH: `${pathPrefix}:${process.env['PATH'] ?? ''}` },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    proc.on('close', (exitCode: number | null) => res({ exitCode: exitCode ?? 1, stdout, stderr }));
    proc.on('error', rej);
  });
}

describe('remove-preview-tag.sh', () => {
  it('succeeds when gcloud removes the tag', async () => {
    const dir = await withStubGcloud('Traffic updated.', 0);
    const r = await run(dir);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Removed tag pr-99.');
  });

  it('succeeds when the tag was already absent', async () => {
    // A PR closed before its first deploy finished, or a re-run. Not a fault.
    const dir = await withStubGcloud('ERROR: (gcloud.run.services.update-traffic) Tag not found: pr-99', 1);
    const r = await run(dir);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('already absent');
  });

  it('FAILS on any other gcloud error rather than reporting nothing to do', async () => {
    // This is the branch the finding was about: a blanket tolerance reported success here,
    // leaving the tag routing while the job went green.
    const dir = await withStubGcloud(
      'ERROR: (gcloud.run.services.update-traffic) PERMISSION_DENIED: caller lacks permission',
      1,
    );
    const r = await run(dir);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('may still be routing');
  });

  it('surfaces the underlying gcloud output on failure, not just its own message', async () => {
    const dir = await withStubGcloud('ERROR: network is unreachable', 1);
    const r = await run(dir);

    expect(r.exitCode).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('network is unreachable');
  });
});

describe('remove-preview-tag.sh — a not-found that is not the tag', () => {
  it('FAILS when the SERVICE is not found, rather than reporting the tag already absent', async () => {
    // The first version of the tolerance pattern accepted a bare "not found", so a wrong
    // service name — the exact misconfiguration this script exists to surface — was reported
    // as "nothing to remove" while the tag kept routing.
    const dir = await withStubGcloud(
      'ERROR: (gcloud.run.services.update-traffic) Service not found: design-space-studio',
      1,
    );
    const r = await run(dir);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('may still be routing');
  });
});
