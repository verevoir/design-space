/**
 * Renders a journey to a standalone document, reading the journey **through the store** at a
 * ref (ADR 0002 — nothing above the resolver constructs a path).
 *
 * This runs at BUILD time, not in the container. The resolver reads via `git show`, so it
 * needs a git repository; baking one into the runtime image to serve a static document would
 * be a large image and a much wider blast radius for no gain. So the repository is read where
 * it actually exists — in CI — and the resulting document is what ships.
 *
 * The consequence worth naming: the deployed service renders nothing at runtime. When phase 2
 * makes journeys editable through the service, this becomes a runtime resolve against the
 * conversation overlay, and the seam it goes through is already this one.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { sketchAdapter } from '@design-space/adapter-sketch';
import { validateJourney } from '@design-space/journey-model';
import { render } from '@design-space/render';
import { resolve as resolveObject } from '@design-space/store';

export interface PrerenderOptions {
  /** Absolute path to the git repository the journey is read from. */
  readonly repoPath: string;
  /** The journey's id, as the store addresses it — not a path. */
  readonly journeyId: string;
  /** The git ref to read at. */
  readonly ref: string;
  /** Which collection the journey lives in. The resolver still names the object within it. */
  readonly root?: string;
  /** Where to write the rendered document. */
  readonly outPath: string;
}

/**
 * Reads the journey at `(journeyId, ref)`, renders it through the sketch adapter, and writes
 * the document. Returns the gaps the render reported, so a caller can surface them rather
 * than discovering them by looking at the page.
 */
export async function prerender(options: PrerenderOptions): Promise<{ gaps: readonly string[] }> {
  const raw = await resolveObject(
    options.repoPath,
    { kind: 'journey', id: options.journeyId },
    options.ref,
    { root: options.root ?? 'examples' },
  );

  // Validate rather than cast. A journey that reaches the renderer unvalidated would fail
  // somewhere downstream with a message about markup rather than about the document.
  const result = validateJourney(JSON.parse(raw));
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(
      `Journey '${options.journeyId}' at ref '${options.ref}' is not a valid journey document — ${detail}`,
    );
  }

  const rendered = render(result.document, sketchAdapter);

  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, rendered.html, 'utf-8');

  return { gaps: rendered.gaps.map((g) => g.component) };
}
