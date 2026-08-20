/**
 * The sketch adapter: implements the component port in the hand-drawn style.
 *
 * Story 2S.1 implements ONE component — `prompt`. Wave 3.1 will complete the
 * full port. Nothing in this package may know which journey it is rendering.
 *
 * As of story 2.2, the adapter also supplies `styles` (component appearance,
 * moved out of `render`'s module constant) and `tokens` (this adapter's
 * design tokens as structured data) — ADR 0008.
 */

export const PACKAGE_NAME = '@design-space/adapter-sketch';

export { sketchAdapter } from './adapter.js';
export { SKETCH_CSS_CUSTOM_PROPERTIES } from './tokens.js';
export { SKETCH_STYLES } from './styles.js';
export type { Adapter, ComponentRenderer } from '@design-space/adapter-contract';
