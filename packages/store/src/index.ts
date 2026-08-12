/**
 * The store: the (object, ref) resolver. Git-backed in phase 1.
 *
 * Every object is addressed as (object, ref) and resolved through `resolve()` — the single
 * function that constructs a path and reads content via `git show`. Nothing above this
 * resolver may construct a path or open a file directly (ADR 0002, AGENTS.md §4).
 */
export { resolve, ObjectNotFoundError } from './resolver.js';
export type { ObjectKind, ObjectRef } from './resolver.js';

/** Package identity — kept for the entry-point smoke test. */
export const PACKAGE_NAME = '@design-space/store';
