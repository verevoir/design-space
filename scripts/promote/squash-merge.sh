#!/usr/bin/env bash
#
# Squash-merge the pull request, and write the resulting commit SHA to stdout.
#
#   usage: squash-merge.sh <owner/repo> <pr-number>
#
# Already-merged detection is what makes this re-runnable. A merge that succeeded and then lost
# its answer to a timeout would, on retry, fail with "not mergeable" — which reads as a broken
# promotion when in fact the promotion worked. So the state is checked first and an
# already-merged PR is a success that reports the existing merge commit.
#
# Exit status:
#   0  the PR is merged; its merge commit SHA is on stdout
#   1  it is not, and this run did not merge it
set -euo pipefail

REPO="${1:?owner/repo required}"
PR="${2:?pr number required}"

merge_sha() {
  gh pr view "$PR" --repo "$REPO" --json mergeCommit --jq '.mergeCommit.oid // ""' 2>/dev/null
}

# stdout and stderr are captured SEPARATELY here, not merged with 2>&1: STATE is compared
# exactly against "MERGED" and "OPEN" below, and a warning gh writes to stderr on an otherwise-
# successful call would land inside that string and break the comparison — a perfectly mergeable
# PR refused because STATE was neither string any more, exactly for the wrong reason.
STATE_STDERR="$(mktemp)"
STATE="$(gh pr view "$PR" --repo "$REPO" --json state --jq '.state' 2>"$STATE_STDERR")" || {
  STATE_ERR="$(cat "$STATE_STDERR")"
  rm -f "$STATE_STDERR"
  echo "::error title=Merge failed::could not read the state of ${REPO}#${PR}: ${STATE}${STATE_ERR}" >&2
  exit 1
}
rm -f "$STATE_STDERR"

if [ "$STATE" = "MERGED" ]; then
  SHA="$(merge_sha)"
  if [ -z "$SHA" ]; then
    echo "::error title=Merge ambiguous::${REPO}#${PR} reports MERGED but names no merge commit." >&2
    exit 1
  fi
  echo "::notice title=Already merged::${REPO}#${PR} was already merged as ${SHA}; treating this step as done." >&2
  printf '%s\n' "$SHA"
  exit 0
fi

if [ "$STATE" != "OPEN" ]; then
  echo "::error title=Merge refused::${REPO}#${PR} is ${STATE}, not OPEN." >&2
  exit 1
fi

set +e
OUT="$(gh pr merge "$PR" --repo "$REPO" --squash --delete-branch=false 2>&1)"
RC=$?
set -e

[ -n "$OUT" ] && echo "$OUT" >&2

if [ "$RC" -ne 0 ]; then
  echo "::error title=Merge failed::gh exited ${RC} merging ${REPO}#${PR}." >&2
  exit "$RC"
fi

SHA="$(merge_sha)"
if [ -z "$SHA" ]; then
  echo "::error title=Merge ambiguous::${REPO}#${PR} merged but names no merge commit." >&2
  exit 1
fi

printf '%s\n' "$SHA"
