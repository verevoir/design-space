/**
 * Type declaration for service-urls.mjs, which has no declarations of its own (TS7016) — the
 * script stays plain JS/JSDoc; this file exists only so tests/tsconfig.json's strict settings can
 * type-check its one import. Kept in sync with the JSDoc in service-urls.mjs by hand: the two are
 * not generated from a shared source, so a signature change to the script that doesn't update
 * this file would go undetected until the next edit here — same failure mode as any hand-written
 * declaration, not specific to this one.
 */
export function serviceUrls(raw: string, tag: string): { tagUrl: string; serviceUrl: string };
