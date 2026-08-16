#!/usr/bin/env bash
#
# Restore the traffic assignment captured before the promotion started, and drop the candidate
# tag. Nothing is rebuilt: the revision being restored to already exists and already served
# traffic, so recovery is one API call and does not wait on CI.
#
#   usage: rollback.sh <snapshot-file> [tag-to-remove] [owner/repo] [pr-number]
#
# owner/repo and pr-number are OPTIONAL, and exist for exactly one reason: a second, independent
# check that this pull request has not already been merged. The workflow's own condition
# (steps.merge.conclusion != 'success') is necessary but not sufficient — `gh pr merge` can
# succeed on GitHub's side and then have its OWN step marked cancelled by a job-level timeout
# landing mid-step. Passing repo+PR here lets this script ask GitHub directly, as a second line
# of defence before it touches any traffic. Omitting them is backward compatible: the script
# proceeds with the restore exactly as it always did.
#
# Idempotent by construction. Restoring an assignment that is already in place is a no-op, and a
# tag that is already gone is not an error — a rollback that failed when run twice would be a
# rollback nobody dares re-run.
#
# Verification is by TRAFFIC ASSIGNMENT, not by smoking the restored revision. The current
# rollback target predates the `/health` endpoint and 404s it, so a smoke against it would
# report a failed rollback that in fact succeeded. See the ADR 0007 amendment: this is a
# one-time condition that ends with the first successful promotion.
#
# Exit status:
#   0  traffic is back on the captured assignment and the tag is gone
#   n  it is not — this is an incident; the message says what state to expect
set -euo pipefail

SNAPSHOT="${1:?snapshot file required}"
TAG="${2:-}"
REPO="${3:-}"
PR="${4:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -s "$SNAPSHOT" ]; then
  echo "::error title=Rollback failed::no restore point at ${SNAPSHOT}; traffic must be restored by hand." >&2
  exit 1
fi

# The second, independent MERGED check. Best-effort in the direction that matters: an unreadable
# `gh` call must not strand traffic on an incident already underway — the workflow-level
# condition is still the first line of defence — so only a CONFIRMED "MERGED" answer stops this
# script. Anything else (OPEN, an error, a timeout) falls through to the restore.
if [ -n "$REPO" ] && [ -n "$PR" ]; then
  set +e
  MERGE_STATE="$(gh pr view "$PR" --repo "$REPO" --json state --jq '.state' 2>/dev/null)"
  set -e
  if [ "$MERGE_STATE" = "MERGED" ]; then
    echo "::error title=Rollback refused::${REPO}#${PR} is already MERGED; traffic must NOT be rolled back onto a commit that is no longer on the base branch. This is the split-brain the workflow's own condition alone cannot close — an operator must decide what happens next." >&2
    exit 1
  fi
fi

# One call, tab-separated, rather than two node startups reading the same file.
if ! IFS=$'\t' read -r SERVICE REGION < <(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(`${s.service}\t${s.region}\n`)' "$SNAPSHOT"); then
  echo "::error title=Rollback failed::the restore point at ${SNAPSHOT} names no service and region; traffic must be restored by hand." >&2
  exit 1
fi

if [ -z "${SERVICE:-}" ] || [ -z "${REGION:-}" ]; then
  echo "::error title=Rollback failed::the restore point at ${SNAPSHOT} names no service and region; traffic must be restored by hand." >&2
  exit 1
fi

if ! SPEC="$(node "${SCRIPT_DIR}/traffic-snapshot.mjs" --restore-spec < "$SNAPSHOT")"; then
  echo "::error title=Rollback failed::the restore point at ${SNAPSHOT} could not be read; traffic must be restored by hand." >&2
  exit 1
fi

echo "==> restoring traffic to ${SPEC}"

set +e
OUT="$(gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" \
  --to-revisions "$SPEC" \
  --quiet 2>&1)"
RC=$?
set -e

[ -n "$OUT" ] && echo "$OUT"

if [ "$RC" -ne 0 ]; then
  echo "::error title=Rollback failed::could not restore traffic to ${SPEC}; the service may be serving the failed candidate." >&2
  exit "$RC"
fi

echo "OK    traffic restored to ${SPEC}."

# Removing the tag is best-effort in ONE direction only: absent is fine, anything else is not.
# The same three-part condition as remove-preview-tag.sh, and for the same reason — a bare
# "not found" also matches "Service not found", which is a misconfiguration this must surface.
if [ -n "$TAG" ]; then
  set +e
  TAG_OUT="$(gcloud run services update-traffic "$SERVICE" \
    --region "$REGION" \
    --remove-tags "$TAG" \
    --quiet 2>&1)"
  TAG_RC=$?
  set -e

  [ -n "$TAG_OUT" ] && echo "$TAG_OUT"

  if [ "$TAG_RC" -eq 0 ]; then
    echo "OK    removed the ${TAG} tag."
  elif echo "$TAG_OUT" | grep -qiE "not found|does not exist" \
    && echo "$TAG_OUT" | grep -qi "tag" \
    && echo "$TAG_OUT" | grep -qF "$TAG"; then
    echo "OK    the ${TAG} tag was already absent."
  else
    echo "::error title=Rollback incomplete::traffic was restored but the ${TAG} tag may still be routing." >&2
    exit "$TAG_RC"
  fi
fi

echo "::notice title=Deployment rolled back::the promotion failed and traffic was restored to ${SPEC}. This deployment is recorded as failed; nothing was merged."
