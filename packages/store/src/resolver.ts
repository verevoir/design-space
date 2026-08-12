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
 *
 * Input validation
 * ----------------
 * `ref`, `root`, and `object.id` are all validated at the boundary against explicit
 * allow-patterns before they reach the git command. The validator rejects rather than
 * sanitises — a bad value fails loudly so the caller can correct it, rather than being
 * silently rewritten into something that works in an unexpected way.
 *
 * `ref`  — must match SAFE_REF (alphanumeric start, then alphanumeric / . _ / - only);
 *           must not contain `..`; must not begin with `-`.
 * `root` — must match SAFE_ROOT (same character set); must not contain `..`; must not
 *           contain an empty segment (consecutive `/` or a leading `/`).
 * `id`   — must match SAFE_ID (alphanumeric start, then alphanumeric / _ / - only);
 *           must not contain `..`, `/`, or any character that would alter the path;
 *           stricter than `root` because an id is a name, not a path.
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
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when an (object, ref) pair is confirmed absent — git answered "not
 * found" with a normal (non-signal) exit. Both the object identity and the git
 * ref are included so the caller knows exactly what was missing.
 *
 * This is a terminal condition: the object is not there and retrying will not
 * help.
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

/**
 * Thrown when the lookup could not be completed because the subprocess was
 * killed by a signal (including the timeout kill sent when `execFile`'s
 * `timeout` option fires). The object may or may not exist — the question was
 * not answered.
 *
 * This is a transient condition: a caller that can retry should, rather than
 * treating the object as absent.
 */
export class ObjectLookupError extends Error {
  readonly object: ObjectRef;
  readonly ref: string;

  constructor(object: ObjectRef, ref: string, cause?: unknown) {
    super(
      `object lookup failed (subprocess killed by signal): kind=${object.kind} id=${object.id} at ref=${ref}`,
    );
    this.name = 'ObjectLookupError';
    this.object = object;
    this.ref = ref;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when `ref`, `root`, or `id` fails the input-validation allow-pattern.
 *
 * This is a caller error — the value supplied does not satisfy the contract.
 * Retrying with the same value will not help.
 */
export class InvalidRefError extends Error {
  constructor(field: 'ref' | 'root' | 'id', value: string, reason: string) {
    super(`invalid ${field}: ${JSON.stringify(value)} — ${reason}`);
    this.name = 'InvalidRefError';
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Allow-pattern for a git ref (branch name, tag, or commit SHA).
 *
 * Must start with an alphanumeric character (guards against a leading `-` which
 * would make the argument look like a git option). Subsequent characters may be
 * alphanumeric, `.`, `_`, `/`, or `-`.
 *
 * Applied together with an explicit `..` rejection: the pattern alone would
 * permit `a..b` which is a git range operator and not a valid single-object ref.
 */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Allow-pattern for a repository-relative root path.
 *
 * Same character set as SAFE_REF. Applied together with explicit checks for
 * `..` (path traversal) and empty segments (consecutive `/` or a leading `/`).
 */
const SAFE_ROOT = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Allow-pattern for an object id.
 *
 * An id is a name, not a path: it must not contain `/` (no traversal into a
 * subdirectory), `.` (no extension tricks), or any character that would alter
 * the path `objectPath()` constructs. Strictly alphanumeric plus `-` and `_`,
 * must start with an alphanumeric character (no leading `-`).
 *
 * Deliberately stricter than SAFE_ROOT, which may legitimately contain `/`.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Validate an object id at the boundary. Throws `InvalidRefError` if the value
 * is rejected. An id is a name, not a path — it must contain no `/`, no `..`,
 * and must not begin with `-`.
 */
function validateId(id: string): void {
  if (id === '') {
    throw new InvalidRefError('id', id, 'id must not be empty');
  }
  if (id.startsWith('-')) {
    throw new InvalidRefError('id', id, 'id must not start with "-" (argument-injection guard)');
  }
  if (id.includes('..')) {
    throw new InvalidRefError('id', id, 'id must not contain ".." (path-traversal guard)');
  }
  if (id.includes('/')) {
    throw new InvalidRefError('id', id, 'id must not contain "/" — an id is a name, not a path');
  }
  if (!SAFE_ID.test(id)) {
    throw new InvalidRefError('id', id, 'id contains characters outside the allowed set [A-Za-z0-9_-]');
  }
}

/**
 * Validate a git ref at the boundary. Throws `InvalidRefError` if the value is
 * rejected. Accepts the empty string only for the `root` field (absent root).
 */
function validateRef(ref: string): void {
  if (ref === '') {
    throw new InvalidRefError('ref', ref, 'ref must not be empty');
  }
  if (ref.startsWith('-')) {
    throw new InvalidRefError('ref', ref, 'ref must not start with "-" (argument-injection guard)');
  }
  if (ref.includes('..')) {
    throw new InvalidRefError('ref', ref, 'ref must not contain ".." (range operator guard)');
  }
  if (!SAFE_REF.test(ref)) {
    throw new InvalidRefError('ref', ref, 'ref contains characters outside the allowed set [A-Za-z0-9._/-]');
  }
}

/**
 * Validate a root path segment at the boundary. An absent (empty string) root
 * is valid — it means the collection is at the repository root. Throws
 * `InvalidRefError` if the value is rejected.
 */
function validateRoot(root: string): void {
  if (root === '') {
    return; // absent root is valid
  }
  if (root.startsWith('-')) {
    throw new InvalidRefError('root', root, 'root must not start with "-" (argument-injection guard)');
  }
  if (root.includes('..')) {
    throw new InvalidRefError('root', root, 'root must not contain ".." (path-traversal guard)');
  }
  if (root.startsWith('/') || root.includes('//')) {
    throw new InvalidRefError('root', root, 'root must not contain empty path segments');
  }
  if (!SAFE_ROOT.test(root)) {
    throw new InvalidRefError('root', root, 'root contains characters outside the allowed set [A-Za-z0-9._/-]');
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
// Options
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Reads the content of an object at a given git ref from the repository at `repoPath`.
 *
 * Uses `git show <ref>:<path>` — no checkout, no working-tree mutation. Multiple calls
 * with different refs may run concurrently without interference.
 *
 * `ref`, `root` (if supplied), and `object.id` are all validated against explicit
 * allow-patterns before reaching the git command. A value that fails validation throws
 * `InvalidRefError` immediately rather than being silently rewritten.
 *
 * @param repoPath  Absolute path to the git repository root.
 * @param object    The object to read, identified by kind and id.
 * @param ref       The git ref (branch name, tag, or commit SHA) to read at.
 * @param options   Optional settings; `root` scopes the lookup to a subdirectory.
 * @returns         The raw UTF-8 content of the object at that ref.
 * @throws          `InvalidRefError` if `ref`, `root`, or `object.id` fails the
 *                  input-validation allow-pattern.
 * @throws          `ObjectNotFoundError` if git confirmed the object does not exist at the
 *                  given ref (normal non-zero exit).
 * @throws          `ObjectLookupError` if the subprocess was killed by a signal (including
 *                  the timeout kill when the process runs too long) — the object's existence
 *                  is unknown and the caller may retry.
 */
export async function resolve(
  repoPath: string,
  object: ObjectRef,
  ref: string,
  options: ResolveOptions = {},
): Promise<string> {
  // Validate root against the raw value the caller supplied — BEFORE any
  // normalisation. Trimming trailing slashes first would collapse an all-slash
  // root (e.g. "/" or "///") to the empty string, causing validation to treat
  // it as an absent root and silently pass it through to git. Validating first
  // means a caller who passed "/" gets an explicit rejection rather than silent
  // reinterpretation as "no root".
  //
  // After validation, trailing slashes are stripped for convenience: a trailing
  // slash on "collections/" is unambiguous and normalising it avoids a
  // surprising rejection. Leading slashes are NOT stripped — the validator
  // already rejects them, so stripping them would only mask a caller error.
  validateRef(ref);
  validateRoot(options.root ?? '');
  validateId(object.id);

  const root = options.root?.replace(/\/+$/g, '') ?? '';

  const gitPath = root ? `${root}/${objectPath(object)}` : objectPath(object);
  const refPath = `${ref}:${gitPath}`;

  try {
    const { stdout } = await execFileAsync('git', ['show', refPath], {
      cwd: repoPath,
      encoding: 'utf8',
      // Prevent any git pager from blocking the process.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      // Bound the subprocess so a hung git process does not stall the caller
      // indefinitely. 10 s is generous for a local read.
      timeout: 10_000,
    });
    return stdout;
  } catch (err) {
    // A process killed by signal (including the SIGTERM sent when the timeout
    // fires) means the question was not answered — the object may or may not
    // exist. Surface this as a distinct error so callers can retry rather than
    // treating it as a confirmed absence.
    //
    // execFile errors carry a `signal` property (string | null) when the child
    // process was terminated by a signal; it is null for a normal non-zero exit.
    const signal =
      err !== null && typeof err === 'object' && 'signal' in err
        ? (err as Record<string, unknown>)['signal']
        : null;

    if (signal !== null && signal !== undefined) {
      throw new ObjectLookupError(object, ref, err);
    }
    throw new ObjectNotFoundError(object, ref, err);
  }
}
