#!/usr/bin/env bash
#
# Assert that the actor who triggered this run holds at least write access to this repository.
#
#   usage: assert-authorized.sh <owner/repo> <actor>
#
# WHY THIS EXISTS, GIVEN THE WORKFLOW ALREADY RUNS ONLY ON A LABEL. Applying a label needs only
# GitHub's `triage` role — a role that exists specifically so someone can organise issues and
# pull requests WITHOUT being able to push code. "Applying the label already requires write
# access" is therefore not quite true; it requires a role strictly WEAKER than write. This job
# shifts live production traffic and merges to `main` unattended, so it checks the stronger
# bound explicitly rather than trusting the narrower one the label mechanism actually enforces.
#
# Exit status:
#   0  the actor holds admin or write permission — promotion may proceed
#   1  it does not, or the permission could not be read — fail closed
set -euo pipefail

REPO="${1:?owner/repo required}"
ACTOR="${2:?actor required}"

# stdout and stderr captured SEPARATELY, as in squash-merge.sh: PERM is compared exactly against
# "admin" and "write" below, and a warning gh writes to stderr on an otherwise-successful call
# would land inside that string and break the comparison — an authorised actor refused for
# exactly the wrong reason.
PERM_STDERR="$(mktemp)"
PERM="$(gh api "repos/${REPO}/collaborators/${ACTOR}/permission" --jq '.permission' 2>"$PERM_STDERR")" || {
  ERR="$(cat "$PERM_STDERR")"
  rm -f "$PERM_STDERR"
  echo "::error title=Promotion blocked::could not read ${ACTOR}'s permission on ${REPO}: ${PERM}${ERR}" >&2
  exit 1
}
rm -f "$PERM_STDERR"

case "$PERM" in
  admin|write)
    exit 0
    ;;
  *)
    echo "::error title=Promotion blocked::${ACTOR} triggered this promotion but holds only '${PERM}' permission on ${REPO}. Applying the promote label needs only 'triage', which is narrower than write — moving production traffic and merging to main requires admin or write." >&2
    exit 1
    ;;
esac
