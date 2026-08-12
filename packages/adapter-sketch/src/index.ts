/**
 * The sketch adapter: implements the component port in the hand-drawn style.
 *
 * Story 2S.1 implements ONE component — `prompt`. Wave 3.1 will complete the
 * full port. Nothing in this package may know which journey it is rendering.
 */

export const PACKAGE_NAME = '@design-space/adapter-sketch';

export { sketchAdapter } from './adapter.js';
export { SKETCH_CSS_CUSTOM_PROPERTIES } from './tokens.js';
export type { Adapter, ComponentRenderer } from './adapter.js';
