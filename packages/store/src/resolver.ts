/**
 * The (object, ref) resolver — the single place in the codebase that maps an object
 * identity (kind + id) to a git path and reads the content at a given ref.
 *
 * Nothing above this module may construct a path or open a file directly (ADR 0002,
 * AGENTS.md §4). The seam exists so that swapping the storage backend in phase 2 is a
 * resolver replacement, not a rewrite of every call site.
 *
 * Reads use `git show <ref>:<path>` via child_process.execFile — no shell string
 * interpolation, no working-tree changes, no checkout. Concurrent reads at different refs
 * are safe because git-show is read-only and does not touch the index or the working tree.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Object identity
// ---------------------------------------------------------------------------

/**
 * The kinds of object the store knows about.
 *
 * - `journey`   — a journey document (one file per id under journeys/)
 * - `port`      — the single component-port manifest (id is ignored; conventional value: "port")
 * - `adapter`   — an adapter module (one file per id under adapters/)
 * - `token-set` — a token-set data file (one file per id under tokens/)
 */
export type ObjectKind = 'journey' | 'port' | 'adapter' | 'token-set';

/**
 * An object reference: the (kind, id) pair that uniquely names an object.
 * Callers never construct a path — they supply a kind and an id.
 */
export interface ObjectRef {
  readonly kind: ObjectKind;
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when an (object, ref) pair cannot be resolved. Both the object identity and the
 * git ref are included so the caller knows exactly what was missing.
 */
export class ObjectNotFoundError extends Error {
  readonly object: ObjectRef;
  readonly ref: string;

  constructor(object: ObjectRef, ref: string, cause?: unknown) {
    super(
      `object not found: kind=${object.kind} id=${object.id} at ref=${ref}`,
    );
    this.name = 'ObjectNotFoundError';
    this.object = object;
    this.ref = ref;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Path construction (private to this module)
// ---------------------------------------------------------------------------

/**
 * Maps an ObjectRef to the repository-relative path that stores its content.
 *
 * Layout (all paths relative to the repository root):
 *   journeys/<id>.json      — journey documents
 *   port/port.json          — the single component port (id is "port" by convention)
 *   adapters/<id>.js        — adapter modules
 *   tokens/<id>.json        — token sets
 */
/**
 * Where a collection of objects is rooted within the repository.
 *
 * This is configuration, not a path a caller builds: the caller says which collection to read
 * from, and the resolver still decides how an object of a given kind is named inside it. Without
 * it the convention below is fixed at the repository root, which silently cannot reach a journey
 * stored anywhere else — the defect this option was added to fix.
 */
export interface ResolveOptions {
  readonly root?: string;
}

function objectPath(object: ObjectRef): string {
  switch (object.kind) {
    case 'journey':
      return `journeys/${object.id}.json`;
    case 'port':
      return `port/port.json`;
    case 'adapter':
      return `adapters/${object.id}.js`;
    case 'token-set':
      return `tokens/${object.id}.json`;
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Reads the content of an object at a given git ref from the repository at `repoPath`.
 *
 * Uses `git show <ref>:<path>` — no checkout, no working-tree mutation. Multiple calls
 * with different refs may run concurrently without interference.
 *
 * @param repoPath  Absolute path to the git repository root.
 * @param object    The object to read, identified by kind and id.
 * @param ref       The git ref (branch name, tag, or commit SHA) to read at.
 * @returns         The raw UTF-8 content of the object at that ref.
 * @throws          `ObjectNotFoundError` if the object does not exist at the given ref.
 */
export async function resolve(
  repoPath: string,
  object: ObjectRef,
  ref: string,
  options: ResolveOptions = {},
): Promise<string> {
  const root = options.root?.replace(/^\/+|\/+$/g, '') ?? '';
  const gitPath = root ? `${root}/${objectPath(object)}` : objectPath(object);
  const refPath = `${ref}:${gitPath}`;

  try {
    const { stdout } = await execFileAsync('git', ['show', refPath], {
      cwd: repoPath,
      encoding: 'utf8',
      // Prevent any git pager from blocking the process.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (err) {
    throw new ObjectNotFoundError(object, ref, err);
  }
}
