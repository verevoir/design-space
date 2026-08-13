/**
 * The preview workflow reads two URLs out of `gcloud run services describe`. The failure that
 * matters is the quiet one: if the tag lookup returned nothing and the workflow carried on, the
 * smoke tests would run against an empty URL and report success against nothing at all.
 */
import { describe, expect, it } from 'vitest';

import { serviceUrls } from '../scripts/service-urls.mjs';

const SERVICE_URL = 'https://design-space-studio-j5xb2z56mq-nw.a.run.app';
const TAG_URL = 'https://pr-6---design-space-studio-j5xb2z56mq-nw.a.run.app';

const describeOutput = (traffic: unknown, url: unknown = SERVICE_URL): string =>
  JSON.stringify({ status: { url, traffic } });

describe('serviceUrls', () => {
  it('returns both URLs when the tag is present', () => {
    const raw = describeOutput([
      { revisionName: 'design-space-studio-00007', percent: 100 },
      { revisionName: 'design-space-studio-00008', tag: 'pr-6', url: TAG_URL },
    ]);

    expect(serviceUrls(raw, 'pr-6')).toEqual({ tagUrl: TAG_URL, serviceUrl: SERVICE_URL });
  });

  it('throws naming the tags that ARE present when the wanted one is absent', () => {
    const raw = describeOutput([
      { tag: 'pr-4', url: 'https://pr-4---x.run.app' },
      { tag: 'candidate', url: 'https://candidate---x.run.app' },
    ]);

    // The message has to say what it found, or a failed preview is a guessing game.
    expect(() => serviceUrls(raw, 'pr-6')).toThrow(/no traffic entry tagged "pr-6"/);
    expect(() => serviceUrls(raw, 'pr-6')).toThrow(/pr-4, candidate/);
  });

  it('throws when the service has no tags at all', () => {
    expect(() => serviceUrls(describeOutput([{ percent: 100 }]), 'pr-6')).toThrow(
      /has no tags/,
    );
  });

  it('throws when the tagged entry carries no url', () => {
    const raw = describeOutput([{ tag: 'pr-6' }]);

    expect(() => serviceUrls(raw, 'pr-6')).toThrow(/has no url/);
  });

  it('throws when the service has not finished deploying and has no url', () => {
    expect(() => serviceUrls(describeOutput([{ tag: 'pr-6', url: TAG_URL }], null), 'pr-6')).toThrow(
      /no status\.url/,
    );
  });

  it('throws legibly on output that is not JSON, rather than a parser stack trace', () => {
    expect(() => serviceUrls('ERROR: (gcloud) something went wrong', 'pr-6')).toThrow(
      /could not parse the gcloud describe output as JSON/,
    );
  });
});
