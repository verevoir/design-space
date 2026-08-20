#!/usr/bin/env bash
#
# Move a proportion of production traffic onto a named revision.
#
#   usage: shift-traffic.sh <service> <region> <revision> <percent>
#
# By revision NAME, never by tag. The candidate tag exists so the smoke and the health check
# have a URL that reaches the candidate specifically; traffic is a different question, and
# pinning it to a name means the assignment still says what it means after the tag is dropped.
#
# Idempotent: setting a revision to the percentage it already has is the same API call and the
# same end state, so a re-run after a timeout cannot double-apply. That matters because a step
# that times out has NOT necessarily failed to act — it may have acted and lost the answer.
#
# Exit status:
#   0  the revision now carries <percent> of traffic
#   n  gcloud failed — traffic may be in an intermediate state; the caller must roll back
set -euo pipefail

SERVICE="${1:?service name required}"
REGION="${2:?region required}"
REVISION="${3:?revision name required}"
PERCENT="${4:?percent required}"

if ! [[ "$PERCENT" =~ ^([0-9]|[1-9][0-9]|100)$ ]]; then
  echo "::error title=Promotion blocked::percent must be an integer 0-100, got '${PERCENT}'." >&2
  exit 1
fi

echo "==> shifting ${PERCENT}% of traffic to ${REVISION}"

set +e
OUT="$(gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" \
  --to-revisions "${REVISION}=${PERCENT}" \
  --quiet 2>&1)"
RC=$?
set -e

[ -n "$OUT" ] && echo "$OUT"

if [ "$RC" -ne 0 ]; then
  echo "::error title=Traffic shift failed::gcloud exited ${RC} while moving ${PERCENT}% to ${REVISION}; traffic may be split." >&2
  exit "$RC"
fi

echo "OK    ${REVISION} now carries ${PERCENT}% of traffic."
