#!/usr/bin/env node
/**
 * Turn `gcloud run services describe --format json` into a restore point, and turn a restore
 * point back into the argument `gcloud run services update-traffic` needs.
 *
 * This is the rollback path's whole correctness. A snapshot that is subtly wrong is worse than
 * none at all, because the failure surfaces only when it is used — during an incident, on the
 * one code path nobody exercised. So the parsing lives here, with tests, rather than in a jq
 * expression inside a `run:` block.
 *
 * Usage (CLI):
 *   gcloud run services describe S --region R --format json \
 *     | node traffic-snapshot.mjs --snapshot --service S --region R > snapshot.json
 *
 *   node traffic-snapshot.mjs --restore-spec < snapshot.json     # -> "rev-a=90,rev-b=10"
 *   node traffic-snapshot.mjs --revision-for-tag candidate < describe.json
 */

import { pathToFileURL } from 'node:url';

/**
 * Build a restore point from a describe payload.
 *
 * Two things here are load-bearing:
 *
 *  - **`LATEST` is resolved to a concrete revision name.** A restore point that says "whatever
 *    is latest" is not a restore point: by the time it is used, the promotion has deployed a
 *    newer revision, so restoring `LATEST` would route traffic to the very revision being
 *    rolled back.
 *  - **The percentages must total 100.** A partial snapshot restores partial traffic and leaves
 *    the rest wherever the failure left it, which is a split nobody chose.
 */
export function snapshotFromDescribe(describe, { service, region }) {
  const traffic = describe?.status?.traffic;
  if (!Array.isArray(traffic)) {
    throw new Error('describe payload has no status.traffic — cannot capture a restore point');
  }

  const latestReady = describe?.status?.latestReadyRevisionName;
  const byRevision = new Map();

  for (const entry of traffic) {
    const percent = entry?.percent ?? 0;
    if (percent <= 0) continue; // tag-only entries carry no traffic and need no restoring

    const revision = entry?.revisionName ?? (entry?.latestRevision === true ? latestReady : undefined);
    if (!revision) {
      throw new Error(
        'a traffic entry names neither a revision nor a resolvable LATEST — refusing to build a restore point that cannot be replayed',
      );
    }
    // The same revision can appear more than once (for example once tagged, once not).
    byRevision.set(revision, (byRevision.get(revision) ?? 0) + percent);
  }

  const assignments = [...byRevision].map(([revision, percent]) => ({ revision, percent }));
  const total = assignments.reduce((sum, a) => sum + a.percent, 0);
  if (total !== 100) {
    throw new Error(`traffic percentages total ${total}, not 100 — refusing to capture an incomplete restore point`);
  }

  const tags = traffic.filter((entry) => typeof entry?.tag === 'string' && entry.tag).map((entry) => entry.tag);

  return { service, region, assignments, tags };
}

/** The value for `--to-revisions`, e.g. `design-space-studio-00002=100`. */
export function restoreSpec(snapshot) {
  const assignments = snapshot?.assignments;
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error('snapshot carries no assignments — there is nothing to restore to');
  }
  return assignments.map((a) => `${a.revision}=${a.percent}`).join(',');
}

/**
 * Which revision a tag currently points at.
 *
 * The promotion needs the candidate's revision NAME — traffic is pinned by name at the end, and
 * the health check asserts that name came back from `/health`. Reading it from the tag entry is
 * exact; reading `latestCreatedRevisionName` would be a guess that races any other deploy.
 */
export function revisionForTag(describe, tag) {
  const traffic = describe?.status?.traffic;
  if (!Array.isArray(traffic)) throw new Error('describe payload has no status.traffic');

  const entry = traffic.find((t) => t?.tag === tag);
  if (!entry) throw new Error(`no traffic entry carries the tag "${tag}"`);

  const revision = entry.revisionName ?? (entry.latestRevision === true ? describe?.status?.latestReadyRevisionName : undefined);
  if (!revision) throw new Error(`the "${tag}" tag names no resolvable revision`);

  return revision;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function argValue(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const input = JSON.parse(await readStdin());

  if (argv.includes('--snapshot')) {
    const service = argValue(argv, '--service');
    const region = argValue(argv, '--region');
    if (!service || !region) throw new Error('--snapshot requires --service and --region');
    process.stdout.write(`${JSON.stringify(snapshotFromDescribe(input, { service, region }), null, 2)}\n`);
    return;
  }

  if (argv.includes('--restore-spec')) {
    process.stdout.write(`${restoreSpec(input)}\n`);
    return;
  }

  const tag = argValue(argv, '--revision-for-tag');
  if (tag) {
    process.stdout.write(`${revisionForTag(input, tag)}\n`);
    return;
  }

  throw new Error('expected one of --snapshot, --restore-spec, --revision-for-tag');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`traffic-snapshot: ${err.message}\n`);
    process.exit(1);
  });
}
