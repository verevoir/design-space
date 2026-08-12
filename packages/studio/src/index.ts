/**
 * The studio: a minimal HTTP server (node:http, no framework) that serves the
 * rendered broadband-switch journey document.
 *
 * Endpoints:
 *   GET /        — the rendered journey HTML
 *   GET /healthz — 200 JSON { status: 'ok', portVersion }
 *
 * Export surface: createStudioServer (testable without binding a port) and
 * startServer (used by the entry-point). The listen call is NOT at module
 * top-level so tests can import freely.
 */
export const PACKAGE_NAME = '@design-space/studio';

export { createStudioServer, startServer } from './server.js';
export { prerender, type PrerenderOptions } from './prerender.js';
export type { ServerOptions } from './server.js';
