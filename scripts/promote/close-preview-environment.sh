#!/usr/bin/env bash
#
# Close the preview environment for a merged pull request: remove its pr-<N> tag from the Cloud
# Run service, then delete its head branch from the remote.
#
# preview.yml's own cleanup job removes the pr-<N> tag, triggered by `pull_request: closed` —
# that is the whole of what it does; it has never deleted a branch, for any PR, human-closed or
# not. The merge two steps earlier in promote.yml runs as GITHUB_TOKEN, and GitHub deliberately
# does not trigger further workflow runs from events an Actions token's own calls produce — to
# prevent recursive workflow loops. That suppression is invisible: no error, no skipped run, no
# run at all. So `pull_request: closed` is never delivered for a self-promoted merge, and the
# cleanup job — correct on its own terms for the human-closes-a-PR-by-hand case it was built for
# — never fires for this one. This script restores that tag removal for a self-promoted merge,
# and additionally deletes the head branch — behaviour no existing job performs at all, added
# here because a self-promoted merge is the one case nothing else closes out.
#
#   usage: close-preview-environment.sh <service> <region> <tag> <owner/repo> <branch>
#
# Idempotent by construction, for the same reason as remove-preview-tag.sh: this can run again on
# a re-run after a lost answer, and a tag or branch that is already gone must read as success,
# not as a fault to chase.
#
# ORDER IS DELIBERATE. The tag is removed first and the branch is left entirely alone if that
# fails, so a partial success stays legible — a tag-only failure and a branch-only failure are
# reported as two different, distinguishable outcomes rather than one compounding into the other.
#
# Exit status:
#   0  the tag and the branch are both gone — removed now, or already absent
#   1  the tag could not be removed for a real reason; see the underlying gcloud message
#   2  the branch could not be deleted for a real reason; the tag was handled, only the branch remains
set -euo pipefail

SERVICE="${1:?service name required}"
REGION="${2:?region required}"
TAG="${3:?tag required}"
REPO="${4:?owner/repo required}"
BRANCH="${5:?branch required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Delegated, not duplicated: remove-preview-tag.sh already carries the tested three-part
# tolerance for an absent tag versus a real fault. Re-implementing that here would be a second
# place for the same defect class the finding on it once was.
if ! bash "${SCRIPT_DIR}/../remove-preview-tag.sh" "$SERVICE" "$REGION" "$TAG"; then
  echo "::error title=Preview environment not closed::the ${TAG} tag could not be removed; the branch was left in place so the two failures do not compound." >&2
  exit 1
fi

set +e
OUT="$(gh api -X DELETE "repos/${REPO}/git/refs/heads/${BRANCH}" 2>&1)"
RC=$?
set -e

[ -n "$OUT" ] && echo "$OUT"

if [ "$RC" -eq 0 ]; then
  echo "Deleted branch ${BRANCH}."
  exit 0
fi

# An absent branch is the one tolerable failure here — a re-run after a lost answer, or a branch
# someone already deleted by hand. GitHub's own phrasing for this call is "Reference does not
# exist", matched on that exact clause rather than a bare "not found", which this API also
# returns for other malformed requests that are not the tolerable case.
if echo "$OUT" | grep -qi "Reference does not exist"; then
  echo "Branch ${BRANCH} was already absent — nothing to delete."
  exit 0
fi

echo "::error title=Preview environment not closed::the ${TAG} tag is gone, but branch ${BRANCH} could not be deleted (gh exited ${RC})." >&2
exit 2
