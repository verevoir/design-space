#!/usr/bin/env bash
# Union every panel lens's verdict and gate on unanimous approval — the merge gate's
# decision. Fails CLOSED: exits non-zero if any lens rejected, produced a non-APPROVE or
# malformed verdict, is missing, or if a verdict ran for a lens OUTSIDE the gated set
# (matrix/aggregator drift). PANEL_LENSES overrides the lens set when set (tests use
# this); in production it is unset, so the hardcoded default applies. Extracted from the
# workflow so the gate's decision logic is unit-testable.
set -euo pipefail

# Byte semantics for the whole file, and the two guards that need it are BRACKET
# RANGES, not every command that touches text. `case "$lenses" in *[!a-z0-9 -]*)`
# below is the load-bearing one — it blocks glob expansion, path traversal and
# workflow-command injection through a crafted PANEL_LENSES, and under a locale
# that interleaves case `Correctness` does not match the negated class and walks
# straight through. The drift guard's `tr -cd 'a-z0-9-'` is the other.
#
# safe() is NOT among them: `tr -d '\r'` deletes one literal byte and its sed
# substitutions match fixed strings, so no collation is involved. Said explicitly
# because an earlier version of this comment claimed otherwise, and a comment that
# names the wrong reason survives the line it was protecting being changed.
#
# Scoping the pin to one command is the trap rather than the fix: it protects the
# line someone was thinking about and leaves the next one exposed.
export LC_ALL=C

dir="${1:?usage: aggregate.sh <verdicts-dir>}"
lenses="${PANEL_LENSES-correctness security testing docs resilience}"

if [ -z "${lenses//[[:space:]]/}" ]; then
  echo "::error title=No panel lenses::The lens set is empty — refusing to pass a gate that checked nothing. Failing closed."
  exit 1
fi
# Only bare [a-z0-9-] tokens, space-separated: blocks glob expansion, path traversal, and
# workflow-command injection via a crafted PANEL_LENSES before it is split and used in paths.
case "$lenses" in
  *[!a-z0-9\ -]*)
    echo "::error title=Invalid lens set::PANEL_LENSES may contain only [a-z0-9-] tokens. Failing closed."
    exit 1
    ;;
esac

# Neutralise GHA workflow-command injection in anything echoed from a verdict (which
# a prompt-injected panelist controls): strip CR (a literal \r acts as a line
# terminator to the runner, letting '::cmd' open a line sed's ^ never sees), %-encode
# (kills %0D/%0A escape smuggling), then indent any line-start '::'.
safe() { tr -d '\r' | sed -e 's/%/%25/g' -e 's/^::/ ::/'; }

# Bound every jq parse of untrusted panelist JSON: a pathological-but-under-1MB payload
# must fail this one lens closed, not hold the aggregator to the job envelope. The bound
# is env-overridable so tests can exercise the timeout actually firing.
#
# NO BOUND, NO GATE. A bare-jq fallback stood here for hosts without coreutils, which
# is the wrong trade for the same reason it was wrong in panel-memory.sh: it swaps a
# fast, bounded failure for an UNBOUNDED parse of model-written JSON. The difference
# here is what to do instead — this script IS the gate, so it fails CLOSED rather than
# declining quietly. A gate that cannot bound its own parse must not pass anything.
if ! command -v timeout >/dev/null 2>&1; then
  echo "::error title=Gate cannot bound its parse::coreutils timeout is unavailable, so a pathological verdict could hold this step open indefinitely. Failing closed. On a dev machine: install coreutils (macOS: brew install coreutils, and ensure gtimeout is on PATH as timeout)."
  exit 1
fi
# Digits, and NOT ZERO: `timeout 0 cmd` is documented as "no time limit" and runs
# unbounded, so the one value that removes the guarantee also reads as ordinary
# configuration. Leading zeros go with it.
# `${VAR-10}`, NOT `${VAR:-10}`: the colon form substitutes the default for an
# EMPTY value as well as an unset one, which would collapse an explicitly-empty
# override to 10 before the guard below ever sees it — leaving the '' arm of that
# case dead, and the guard claiming to reject something it cannot reach.
JQ_BOUNDED_TIMEOUT="${JQ_BOUNDED_TIMEOUT-10}"
case "$JQ_BOUNDED_TIMEOUT" in
  '' | *[!0-9]* | 0*)
    # The VALUE is not echoed, matching every other guard in this file. It is
    # env-supplied, so it can carry CR, %-escapes or a line-start `::` — the exact
    # smuggling safe() exists to neutralise, and the BASE_REF and sha guards are
    # unit-tested never to echo. A validation guard that quotes its input back is a
    # workflow-command sink wearing a diagnostic's clothes; the variable NAME is
    # enough to fix it.
    echo "::error title=Gate parse bound is invalid::JQ_BOUNDED_TIMEOUT must be a positive whole number of seconds. Failing closed rather than parsing unbounded."
    exit 1
    ;;
esac
jq_bounded() { timeout "$JQ_BOUNDED_TIMEOUT" jq "$@"; }

ok=1
echo "## Antagonistic panel — verdict by lens"
for lens in $lenses; do
  f="$dir/verdict-$lens/verdict.json"
  if [ ! -f "$f" ]; then
    echo "::error title=Missing verdict::Panelist '$lens' produced no verdict — it did not run to completion. Failing closed."
    ok=0
    continue
  fi
  # A verdict is a small JSON object; anything over 1MB is a model-written path gone wrong
  # (or an injection attempt). The read itself is capped at 1MB+1 — size is decided
  # without ever consuming an unbounded stream.
  if [ "$(head -c 1000001 "$f" | wc -c)" -gt 1000000 ]; then
    echo "::error title=Oversize verdict::Panelist '$lens' produced a verdict over 1MB — refusing to parse. Failing closed."
    ok=0
    continue
  fi
  v="$(jq_bounded -r '.verdict // empty' "$f" 2>/dev/null || echo '')"
  # How MANY findings, stated up front. A lens usually returns one finding but
  # sometimes enumerates a class, and the heading never said which — so a reader
  # who fixed "the" finding could not tell whether it had just fixed one example
  # of several and was about to be sent round the loop again for the next.
  #
  # `?` when `.findings` is not an array: the field is model-written, so absent,
  # null or a bare string are all reachable, and NONE of them mean zero. A count
  # we could not take must not be printed as a count of none.
  n="$(jq_bounded -r 'if (.findings | type) == "array" then (.findings | length) else "?" end' "$f" 2>/dev/null || echo '?')"
  [ -n "$n" ] || n='?'
  {
    echo ""
    echo "### ${lens} — ${v:-none} (${n} findings)"
    jq_bounded -r '.summary // ""' "$f" 2>/dev/null || true
    jq_bounded -r '.findings[]? | "  - " + .' "$f" 2>/dev/null || true
  } | safe
  [ "$v" = "APPROVE" ] || ok=0
done

# Drift guard: a verdict that ran for a lens OUTSIDE the gated set (e.g. a lens added to
# the workflow matrix but not here) must fail closed, not be silently ignored.
for d in "$dir"/verdict-*/; do
  [ -e "$d" ] || continue
  got="$(basename "$d")"
  got="${got#verdict-}"
  case " $lenses " in
    *" $got "*) : ;;
    *)
      # $got is a directory name, not verdict JSON, so it bypasses safe(); reduce it to
      # the lens alphabet before embedding it in a workflow command (a crafted name with
      # a newline could otherwise emit a line-starting `::` command of its own).
      # LC_ALL=C pins tr's a-z range to ASCII bytes — POSIX allows locale collation to
      # widen ranges, and this filter must never widen.
      got="$(printf '%s' "$got" | LC_ALL=C tr -cd 'a-z0-9-')"
      echo "::error title=Unexpected lens::'$got' produced a verdict but is not in the gated set — matrix/aggregator drift. Failing closed."
      ok=0
      ;;
  esac
done

echo ""
if [ "$ok" -ne 1 ]; then
  echo "::error title=Change rejected::At least one lens rejected or failed to produce a verdict. The gate fails CLOSED."
  exit 1
fi
echo "Every lens APPROVED — the gate is green."
