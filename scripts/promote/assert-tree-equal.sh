#!/usr/bin/env bash
#
# Assert that the merged commit's tree is identical to the tree that was canaried.
#
#   usage: assert-tree-equal.sh <canaried-commit> <merged-commit>
#
# ADR 0007 rejected requiring SHA equality — GitHub's squash mints a new commit — and settled on
# tree equality, which is the property that actually matters: the same content, whatever the
# commit is called.
#
# THE ORDERING HAZARD, and the decision taken about it.
#
# This necessarily runs AFTER the squash-merge, so a failure here cannot be undone by rolling
# back: the commit is already on the base branch. Ancestry was asserted up front, so a squash
# reproduces the branch tree by construction and this is a confirmation rather than a gate — but
# "should not happen" is not a plan, so:
#
#   - fail loudly, naming both trees;
#   - leave traffic where it is, on the canaried revision, because that revision IS the proven
#     artefact and moving it would replace a known-good state with an unverified one;
#   - do NOT retag, because retagging would stamp the proven image onto a tree nothing proved;
#   - require an operator. There is no safe automatic recovery from "the thing that landed is
#     not the thing that was tested", and inventing one would be guessing at which of the two
#     is correct.
#
# Exit status:
#   0  the trees match
#   1  they do not — see above; this is an incident, not a retry
set -euo pipefail

CANARIED="${1:?canaried commit required}"
MERGED="${2:?merged commit required}"

# Returns the tree SHA on stdout. `exit` would not work here — this is called inside a command
# substitution, so it would only leave the subshell and the caller would carry on with an empty
# tree, comparing "" to "" and reporting a match. `return` plus set -e fails the caller.
resolve_tree() {
  local ref="$1"
  local tree
  if ! tree="$(git rev-parse --verify --quiet "${ref}^{tree}")"; then
    echo "::error title=Tree equality unverifiable::cannot resolve '${ref}' to a tree; a shallow checkout will do this." >&2
    return 1
  fi
  printf '%s' "$tree"
}

CANARIED_TREE="$(resolve_tree "$CANARIED")"
MERGED_TREE="$(resolve_tree "$MERGED")"

if [ "$CANARIED_TREE" = "$MERGED_TREE" ]; then
  echo "OK    the merged tree is identical to the canaried tree (${CANARIED_TREE})."
  exit 0
fi

echo "::error title=Merged tree differs from the canaried tree::${MERGED} has tree ${MERGED_TREE}, but the revision that served production traffic was built from ${CANARIED} with tree ${CANARIED_TREE}." >&2

cat >&2 <<EOF

OPERATOR INTERVENTION REQUIRED.

  What is true right now:
    - ${MERGED} is already on the base branch. This cannot be rolled back by this workflow.
    - Production traffic is still on the revision built from ${CANARIED}, which passed smoke
      and the staged cut. That revision is the proven artefact and has been left serving.
    - The proven image was NOT retagged onto ${MERGED}, because its tree was not proved.

  What to decide:
    - If the merged tree is correct, promote it through this workflow from a fresh branch so it
      earns its own canary. Do not retag the old image onto it.
    - If the merged tree is wrong, revert it on the base branch. Traffic needs no action.

  Ancestry was asserted before the canary, so this state should be unreachable. It is worth
  finding out how it was reached before promoting anything else.
EOF

exit 1
