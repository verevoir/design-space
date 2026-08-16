#!/usr/bin/env bash
#
# Wait, with a bound, for every check on a commit to go green — excluding this workflow's own.
#
#   usage: wait-for-green.sh <owner/repo> <sha> <self-check-name>...
#
# The verdict itself is decided by checks-green.mjs, which is a pure function with tests. This
# script is only the loop and the bound: the exit codes it branches on are that module's.
#
# Environment:
#   WAIT_FOR_GREEN_TIMEOUT   seconds to keep waiting (default 1800)
#   WAIT_FOR_GREEN_INTERVAL  seconds between polls (default 20)
#
# Exit status:
#   0  green
#   1  a check failed, no checks were found, or the bound was reached
set -euo pipefail

REPO="${1:?owner/repo required}"
SHA="${2:?commit sha required}"
shift 2
SELF=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMEOUT="${WAIT_FOR_GREEN_TIMEOUT:-1800}"
INTERVAL="${WAIT_FOR_GREEN_INTERVAL:-20}"

STARTED=$SECONDS

while : ; do
  # per_page=100 rather than --paginate: --paginate concatenates JSON documents, which is not
  # itself valid JSON. This service has nowhere near 100 checks; if it ever does, the verdict
  # becomes wrong silently, so the count is asserted below.
  #
  # stdout and stderr are captured SEPARATELY, not merged with 2>&1: BODY is parsed as JSON
  # below, and a warning gh writes to stderr on an otherwise-successful call would land inside
  # that string and corrupt the parse — silently blocking a healthy promotion on chatter that
  # was never part of the answer.
  API_STDERR="$(mktemp)"
  set +e
  BODY="$(gh api "repos/${REPO}/commits/${SHA}/check-runs?per_page=100" 2>"$API_STDERR")"
  API_RC=$?
  set -e
  API_ERR="$(cat "$API_STDERR")"
  rm -f "$API_STDERR"

  if [ "$API_RC" -ne 0 ]; then
    [ -n "$BODY" ] && echo "$BODY" >&2
    [ -n "$API_ERR" ] && echo "$API_ERR" >&2
    echo "::error title=Promotion blocked::could not read the checks for ${SHA}." >&2
    exit 1
  fi

  # As with the gh api call above: stdout and stderr are captured SEPARATELY, and the parse
  # failure is caught INSIDE node rather than left to crash uncaught. An unguarded JSON.parse
  # here would print a raw, unattributed V8 stack trace to this step's log and exit — a
  # promotion job's failure that says nothing is worse than one that says something wrong,
  # because it reads as a bug in this tooling rather than a diagnosable condition. Every other
  # decision point in scripts/promote/ answers a bad payload with an ::error annotation naming
  # what went wrong; this is that same answer for the one parse in this file that did not have
  # it. checks-green.mjs's own parseCheckRuns guards the identical parse of this same $BODY for
  # the verdict a few lines below — this mirrors that, for the count.
  TOTAL_STDERR="$(mktemp)"
  set +e
  TOTAL="$(printf '%s' "$BODY" | node -e '
    let s = "";
    process.stdin
      .on("data", (d) => (s += d))
      .on("end", () => {
        try {
          process.stdout.write(String(JSON.parse(s).total_count ?? 0));
        } catch (err) {
          process.stderr.write(`could not parse the check-runs response as JSON: ${err.message}\n`);
          process.exit(1);
        }
      });
  ' 2>"$TOTAL_STDERR")"
  TOTAL_RC=$?
  set -e
  TOTAL_ERR="$(cat "$TOTAL_STDERR")"
  rm -f "$TOTAL_STDERR"

  if [ "$TOTAL_RC" -ne 0 ]; then
    echo "::error title=Promotion blocked::could not read the total check count for ${SHA}: ${TOTAL_ERR}" >&2
    exit 1
  fi

  if [ "$TOTAL" -gt 100 ]; then
    echo "::error title=Promotion blocked::${TOTAL} checks on this commit exceeds the single page this reads; the verdict would be based on a subset." >&2
    exit 1
  fi

  set +e
  VERDICT="$(printf '%s' "$BODY" | node "${SCRIPT_DIR}/checks-green.mjs" "${SELF[@]}")"
  RC=$?
  set -e

  echo "checks on ${SHA}: ${VERDICT}"

  case "$RC" in
    0) exit 0 ;;
    2) : ;; # pending — keep waiting
    *)
      echo "::error title=Promotion blocked::${VERDICT}" >&2
      exit 1
      ;;
  esac

  if [ $(( SECONDS - STARTED )) -ge "$TIMEOUT" ]; then
    echo "::error title=Promotion blocked::checks did not go green within ${TIMEOUT}s — ${VERDICT}" >&2
    exit 1
  fi

  sleep "$INTERVAL"
done
