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
  set +e
  # per_page=100 rather than --paginate: --paginate concatenates JSON documents, which is not
  # itself valid JSON. This service has nowhere near 100 checks; if it ever does, the verdict
  # becomes wrong silently, so the count is asserted below.
  BODY="$(gh api "repos/${REPO}/commits/${SHA}/check-runs?per_page=100" 2>&1)"
  API_RC=$?
  set -e

  if [ "$API_RC" -ne 0 ]; then
    echo "$BODY" >&2
    echo "::error title=Promotion blocked::could not read the checks for ${SHA}." >&2
    exit 1
  fi

  TOTAL="$(printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).total_count ?? 0)))')"
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
