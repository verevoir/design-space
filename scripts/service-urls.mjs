/**
 * Extract the URLs a preview deploy needs from `gcloud run services describe --format json`.
 *
 * Lives in a file rather than inline in the workflow so its not-found path can be tested. Inline
 * shell and inline Python in a workflow are only executed when their trigger fires, which for
 * some jobs is never — a stray `fi` sat in the cleanup step through several green runs for
 * exactly that reason.
 *
 *   usage:  gcloud run services describe … --format json | node service-urls.mjs <tag>
 *
 * Prints two `KEY=value` lines on success, suitable for appending to $GITHUB_ENV:
 *
 *   TAG_URL=https://pr-6---design-space-studio-….run.app
 *   SERVICE_URL=https://design-space-studio-….run.app
 *
 * Exits non-zero with a legible reason if the tag is absent or the payload is not what Cloud Run
 * documents, because a preview that silently produced an empty URL would smoke-test nothing and
 * report success.
 */

/** @param {string} raw @param {string} tag */
export function serviceUrls(raw, tag) {
  let svc;
  try {
    svc = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `could not parse the gcloud describe output as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const serviceUrl = svc?.status?.url;
  if (typeof serviceUrl !== 'string' || serviceUrl === '') {
    throw new Error('the service has no status.url — it may not have finished deploying');
  }

  const traffic = svc?.status?.traffic;
  if (!Array.isArray(traffic)) {
    throw new Error('the service has no status.traffic array');
  }

  const entry = traffic.find((t) => t && t.tag === tag);
  if (!entry) {
    const seen = traffic.map((t) => t?.tag).filter(Boolean);
    throw new Error(
      `no traffic entry tagged "${tag}"` +
        (seen.length ? ` — tags present: ${seen.join(', ')}` : ' — the service has no tags'),
    );
  }
  if (typeof entry.url !== 'string' || entry.url === '') {
    throw new Error(`the traffic entry tagged "${tag}" has no url`);
  }

  return { tagUrl: entry.url, serviceUrl };
}

// Run only as the process entry point, so importing this for tests starts nothing.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const tag = process.argv[2];
  if (!tag) {
    process.stderr.write('usage: service-urls.mjs <tag>  (gcloud json on stdin)\n');
    process.exitCode = 2;
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    try {
      const { tagUrl, serviceUrl } = serviceUrls(Buffer.concat(chunks).toString('utf-8'), tag);
      process.stdout.write(`TAG_URL=${tagUrl}\nSERVICE_URL=${serviceUrl}\n`);
    } catch (err) {
      process.stderr.write(
        `service-urls: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
