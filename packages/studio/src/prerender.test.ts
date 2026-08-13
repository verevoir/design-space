/**
 * Prerender is the one place the steel thread actually goes through the store, so these tests
 * drive a REAL git repository rather than a stub: a journey committed at a ref, read back by
 * (kind, id) and ref, and rendered. If they mocked the resolver they would prove nothing about
 * the seam ADR 0002 exists to protect.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectLookupError, ObjectNotFoundError } from '@design-space/store';
import { prerender } from './prerender.js';

const execFileAsync = promisify(execFile);

let repoPath: string;
let outPath: string;

const journey = {
  id: 'demo',
  title: 'A demo journey',
  intent: 'Prove one component travels the whole chain.',
  entry: 'start',
  screens: [
    {
      id: 'start',
      purpose: 'Prove the chain end to end.',
      blocks: [
        { component: 'prompt', props: { heading: 'Choose a new package', explain: 'Provisional.' } },
        { component: 'compare-set', props: { attributes: ['Speed'], items: [] } },
      ],
      actions: [{ label: 'Done', weight: 'primary', target: null }],
      annotations: [],
    },
  ],
};

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'ds-prerender-'));
  outPath = join(repoPath, 'out', 'index.html');

  const git = (...args: string[]) => execFileAsync('git', args, { cwd: repoPath });
  await git('init', '-q');
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');

  await mkdir(join(repoPath, 'examples', 'journeys'), { recursive: true });
  await writeFile(
    join(repoPath, 'examples', 'journeys', 'demo.json'),
    JSON.stringify(journey, null, 2),
    'utf-8',
  );
  await git('add', '-A');
  await git('commit', '-qm', 'the journey under test');
});

afterAll(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
});

describe('prerender', () => {
  it('reads the journey through the store and writes a document', async () => {
    await prerender({ repoPath, journeyId: 'demo', ref: 'HEAD', outPath });

    const html = await readFile(outPath, 'utf-8');
    expect(html).toContain('Choose a new package');
  });

  it('reports the gaps rather than leaving them to be noticed on the page', async () => {
    const { gaps } = await prerender({ repoPath, journeyId: 'demo', ref: 'HEAD', outPath });

    // Only `prompt` is implemented in wave 2S, so compare-set must come back as a gap.
    expect(gaps).toContain('compare-set');
  });

  it('renders the gap into the document instead of dropping the block', async () => {
    await prerender({ repoPath, journeyId: 'demo', ref: 'HEAD', outPath });

    const html = await readFile(outPath, 'utf-8');
    // Asserting the component is NAMED in the output — a test that only counted blocks would
    // pass just as happily if the unimplemented one had silently vanished.
    expect(html).toContain('compare-set');
  });

  it('fails with the journey path when the document is invalid, not with a markup error', async () => {
    const git = (...args: string[]) => execFileAsync('git', args, { cwd: repoPath });
    await writeFile(
      join(repoPath, 'examples', 'journeys', 'broken.json'),
      JSON.stringify({ id: 'broken', title: 'No screens', entry: 'nowhere', screens: [] }),
      'utf-8',
    );
    await git('add', '-A');
    await git('commit', '-qm', 'a journey that does not validate');

    await expect(
      prerender({ repoPath, journeyId: 'broken', ref: 'HEAD', outPath }),
    ).rejects.toThrow(/not a valid journey document/);
  });

  it('propagates ObjectNotFoundError (with the object id and ref) when the journey is genuinely absent', async () => {
    const err = await prerender({ repoPath, journeyId: 'absent', ref: 'HEAD', outPath })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectNotFoundError);
    // Both the id and the ref must be named so the caller can diagnose without grepping logs.
    expect((err as ObjectNotFoundError).message).toContain('absent');
    expect((err as ObjectNotFoundError).message).toContain('HEAD');
  });

  it('propagates ObjectLookupError unchanged (not flattened to ObjectNotFoundError) when the subprocess is killed by a signal', async () => {
    // Put a fake "git" shim first on PATH that kills itself with SIGTERM —
    // same signal the execFile timeout sends. prerender must not flatten this
    // into ObjectNotFoundError; the caller needs to know this is transient.
    const shimDir = mkdtempSync(join(tmpdir(), 'ds-prerender-sigterm-'));
    writeFileSync(join(shimDir, 'git'), '#!/bin/sh\nkill -TERM $$\n', { mode: 0o755 });
    const origPath = process.env['PATH'] ?? '';
    process.env['PATH'] = `${shimDir}:${origPath}`;
    try {
      const err = await prerender({ repoPath, journeyId: 'demo', ref: 'HEAD', outPath })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ObjectLookupError);
    } finally {
      process.env['PATH'] = origPath;
      rmSync(shimDir, { recursive: true, force: true });
    }
  });
});

describe('prerender writes a gaps sidecar alongside the document', () => {
  it('names the sidecar from the document path', async () => {
    const { gapsPathFor } = await import('./prerender.js');

    expect(gapsPathFor('/a/b/document.html')).toBe('/a/b/document.gaps.json');
  });

  it('writes the gaps it reported, so the served document and its gaps agree', async () => {
    const out = join(repoPath, 'out', 'index.html');
    const { gaps } = await prerender({ repoPath, journeyId: 'demo', ref: 'HEAD', outPath: out });

    const { gapsPathFor } = await import('./prerender.js');
    const written = JSON.parse(await readFile(gapsPathFor(out), 'utf-8')) as { component: string }[];

    // The sidecar is the only channel by which the build's findings reach the runtime, so it
    // must carry what prerender actually reported rather than an empty placeholder.
    expect(written.map((g) => g.component)).toEqual(expect.arrayContaining(gaps));
  });
});
