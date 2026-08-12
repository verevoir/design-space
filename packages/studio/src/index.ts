/**
 * The studio: a minimal HTTP server (node:http, no framework) that serves the
 * rendered broadband-switch journey document.
 *
 * Endpoints:
 *   GET /        — the rendered journey HTML
 *   GET /healthz — 200 JSON { status: 'ok', portVersion }
 *
 * Export surface:
 *   - createStudioServer — creates the http.Server without binding a port,
 *     so tests can import and exercise it without a network dependency.
   - startServer — binds the server to a port; used by serve.ts, which reads
 *     the pre-rendered document from disk and passes it to startServer at startup.
 *   - prerender — reads a journey through the store and writes a document;
 *     the build-time half invoked by scripts/prerender-build.mjs.
 *
 * The listen call is NOT at module top-level so tests can import freely.
 * The entry point that wires these two halves together is serve.ts — it reads
 * the pre-rendered document written by the build-time prerender step and calls
 * startServer. That is what the container runs.
 */
export const PACKAGE_NAME = '@design-space/studio';

export { createStudioServer, startServer } from './server.js';
export { prerender, type PrerenderOptions } from './prerender.js';
export type { ServerOptions } from './server.js';
