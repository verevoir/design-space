#!/usr/bin/env bash
#
# Remove a preview tag from the Cloud Run service.
#
# This lives in a script rather than inline in the workflow so it can be tested. The logic is
# three-way and the wrong branch is expensive: a blanket "ignore errors" reports success for
# expired credentials, a network fault or a wrong service name, and leaves the tag routing while
# the job goes green.
#
#   usage: remove-preview-tag.sh <service> <region> <tag>
#
# Exit status:
#   0  the tag was removed, or was already absent
#   n  gcloud failed for any other reason — the tag may still be routing
#
# `gcloud` is taken from PATH so a test can put a stub ahead of the real one.
set -euo pipefail

SERVICE="${1:?service name required}"
REGION="${2:?region required}"
TAG="${3:?tag required}"

set +e
OUT="$(gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" \
  --remove-tags "$TAG" \
  --quiet 2>&1)"
RC=$?
set -e

[ -n "$OUT" ] && echo "$OUT"

if [ "$RC" -eq 0 ]; then
  echo "Removed tag ${TAG}."
  exit 0
fi

# An absent tag is the one tolerable failure: the PR may have closed before its first deploy
# finished, or the job may be re-running. Anything else is a real fault and must be visible.
if echo "$OUT" | grep -qiE "tag.*not.*found|no.*tag.*found|does not exist|not found"; then
  echo "Tag ${TAG} was already absent — nothing to remove."
  exit 0
fi

echo "::error title=Preview tag not removed::gcloud exited ${RC}; the ${TAG} tag may still be routing traffic." >&2
exit "$RC"
