#!/usr/bin/env bash
#
# Capture the service's current traffic assignment as a restore point.
#
# This runs before ANY mutation. The restore point is the only thing that makes the rest of the
# sequence reversible, and it cannot be reconstructed after the fact — once a candidate revision
# is carrying traffic, "what was it before?" has no answer available from the service itself.
#
#   usage: capture-traffic.sh <service> <region> <output-file>
#
# Re-running overwrites the file with the current state. That is safe while nothing has been
# mutated, and the workflow only calls this before the first mutation.
#
# Exit status:
#   0  a complete restore point was written
#   n  gcloud failed, or the state could not be captured completely — see the message
set -euo pipefail

SERVICE="${1:?service name required}"
REGION="${2:?region required}"
OUT="${3:?output file required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# stdout and stderr are captured SEPARATELY, not merged with 2>&1: DESCRIBE is parsed as JSON
# below, and a warning gcloud writes to stderr on an otherwise-successful call (e.g. "Updated
# property [core/project]") would land inside that string and corrupt the parse — refusing to
# start a promotion, with no rollback target, over chatter that was never part of the answer.
DESCRIBE_STDERR="$(mktemp)"
set +e
DESCRIBE="$(gcloud run services describe "$SERVICE" --region "$REGION" --format json 2>"$DESCRIBE_STDERR")"
RC=$?
set -e
DESCRIBE_ERR="$(cat "$DESCRIBE_STDERR")"
rm -f "$DESCRIBE_STDERR"

if [ "$RC" -ne 0 ]; then
  [ -n "$DESCRIBE" ] && echo "$DESCRIBE" >&2
  [ -n "$DESCRIBE_ERR" ] && echo "$DESCRIBE_ERR" >&2
  echo "::error title=Promotion blocked::could not describe ${SERVICE}; refusing to start a promotion with no rollback target." >&2
  exit "$RC"
fi

# The parsing is in node so its failure modes are tested — see tests/promote-decisions.test.ts.
# It refuses to write a snapshot whose percentages do not total 100, or one that would restore
# to LATEST rather than to a concrete revision.
if ! printf '%s' "$DESCRIBE" \
  | node "${SCRIPT_DIR}/traffic-snapshot.mjs" --snapshot --service "$SERVICE" --region "$REGION" > "$OUT"; then
  rm -f "$OUT"
  echo "::error title=Promotion blocked::could not build a restore point from the service's traffic assignment." >&2
  exit 1
fi

echo "OK    captured rollback target to ${OUT}:"
cat "$OUT"
