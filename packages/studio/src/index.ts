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
 *   - startServer — binds the server to a port; intended for use by whatever
 *     wires prerender and the server together (not yet present; see backlog.md).
 *   - prerender — reads a journey through the store and writes a document;
 *     the build-time half that startServer's caller will invoke.
 *
 * The listen call is NOT at module top-level so tests can import freely.
 * Nothing in this package currently wires these two halves together into a
 * runnable entry point; that arrives with backlog.md §2S.2.
 */
export const PACKAGE_NAME = '@design-space/studio';

export { createStudioServer, startServer } from './server.js';
export { prerender, type PrerenderOptions } from './prerender.js';
export type { ServerOptions } from './server.js';
