/**
 * Type declaration for service-urls.mjs, which has no declarations of its own (TS7016) — the
 * script stays plain JS/JSDoc; this file exists only so tests/tsconfig.json's strict settings can
 * type-check its one import. Kept in sync with the JSDoc in service-urls.mjs by hand: the two are
 * not generated from a shared source, so a signature change to the script that doesn't update
 * this file would go undetected until the next edit here — same failure mode as any hand-written
 * declaration, not specific to this one.
 *
 * `.d.mts`, not `.d.ts`: NodeNext module resolution maps a `.mjs` import specifier to a
 * `.d.mts` sibling specifically — a `.d.ts` alongside the same script would not be found, and
 * the import would fail exactly as if no declaration existed at all. This is the first place
 * this repository pairs a `.mjs` script with a hand-written declaration; the next one should
 * follow this suffix rather than rediscover it by watching TS7016 persist.
 *
 * One of three sibling declarations in this directory for otherwise-undeclared .mjs scripts
 * imported by now-type-checked tests (see also check-exit-contracts.d.mts,
 * upsert-preview-comment.d.mts) — all following the reasoning above, stated once here rather
 * than in each: a script's signature drifting and the reason this pattern exists at all are
 * different kinds of change, and only one of them should ever require touching every file in
 * the set.
 */
export function serviceUrls(raw: string, tag: string): { tagUrl: string; serviceUrl: string };
