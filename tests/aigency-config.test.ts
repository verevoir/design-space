import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Structural regression tests for aigency.json — declarative config that decides what runs
// (which gates block a verify pass, which release steps exist, how long each is allowed to
// run) deserves the same shape-pinning promote.yml gets. Assertions here are INVARIANTS, not
// exact content: the working tree can carry rows a given branch does not (this repo's local
// tree, at time of writing, carries two extra release rows — board-status and rerun-checks —
// that belong to a different story and must never ship on this one). Asserting structure
// rather than content is what lets this file hold against either shape.

interface Command {
  name?: unknown;
  kind?: unknown;
  command?: unknown;
  timeoutMs?: unknown;
  blocking?: unknown;
}

const raw = readFileSync(fileURLToPath(new URL('../aigency.json', import.meta.url)), 'utf8');
const config = JSON.parse(raw) as { commands: Command[] };
const commands = config.commands;

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { scripts?: Record<string, string> };
const rootScripts = new Set(Object.keys(pkg.scripts ?? {}));

const KNOWN_KINDS = new Set(['bootstrap', 'gate', 'release']);

describe('aigency.json — every declared command is shaped correctly', () => {
  it('declares a name, a kind, and a non-empty command array on every row', () => {
    const malformed = commands
      .filter(
        (c) =>
          typeof c.name !== 'string' ||
          c.name.length === 0 ||
          typeof c.kind !== 'string' ||
          !Array.isArray(c.command) ||
          c.command.length === 0,
      )
      .map((c) => c.name ?? '(unnamed)');

    expect(malformed).toEqual([]);
  });

  it('never declares a kind outside bootstrap, gate, or release', () => {
    const unknown = commands
      .filter((c) => !KNOWN_KINDS.has(c.kind as string))
      .map((c) => `${c.name}: ${String(c.kind)}`);

    expect(unknown).toEqual([]);
  });

  it('bounds every command with a positive integer timeoutMs', () => {
    const unbounded = commands
      .filter(
        (c) =>
          !(typeof c.timeoutMs === 'number' && Number.isInteger(c.timeoutMs) && c.timeoutMs > 0),
      )
      .map((c) => c.name);

    expect(unbounded).toEqual([]);
  });

  it('names an npm script package.json actually defines, for every command that invokes one', () => {
    // The bug PR #9 exists to fix: an inherited row named a script (`typecheck`) this repo's
    // package.json does not define — `npm run <missing>` fails at the shell, silently, only
    // once the row actually runs. This is the test that would have caught it before it shipped.
    const missing = commands
      .filter(
        (c) => Array.isArray(c.command) && c.command[0] === 'npm' && c.command[1] === 'run',
      )
      .filter((c) => !rootScripts.has((c.command as string[])[2] ?? ''))
      .map((c) => `${c.name} -> ${(c.command as string[])[2]}`);

    expect(missing).toEqual([]);
  });

  it('keeps every release-kind row out of reach of an ordinary gate run', () => {
    // `blocking: true` is the field a gate run reads to decide what belongs to it — every gate
    // row above (build, test, lint) carries it, and no release row should. A release row that
    // did would run inside an ordinary verify pass instead of only when named deliberately —
    // silently spending real money (pregate) or moving GitHub state (rerun-checks) on every
    // commit.
    const reachable = commands
      .filter((c) => c.kind === 'release' && c.blocking === true)
      .map((c) => c.name);

    expect(reachable).toEqual([]);
  });
});
