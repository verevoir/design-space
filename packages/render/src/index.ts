/**
 * The renderer: composes a journey document and an adapter into a standalone
 * HTML document with inline styles and no external network requests.
 *
 * A block whose component the adapter does not implement renders as a visible,
 * labelled gap naming the missing component — never silently skipped, never a
 * crash. Gap records are returned alongside the HTML so callers can inspect
 * what fell back.
 */
export const PACKAGE_NAME = '@design-space/render';

export { render } from './render.js';
export type { AdapterLike, GapRecord, RenderResult } from './render.js';
