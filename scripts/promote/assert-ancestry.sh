#!/usr/bin/env bash
#
# Assert that the branch about to be promoted is up to date with the base.
#
# ADR 0007 leans on this twice. It is what makes the merge afterwards a formality that cannot
# conflict, and it is what makes the tree-equality check after the squash a confirmation rather
# than a gate — if the base is already an ancestor, a squash necessarily reproduces the branch's
# tree. Assert it BEFORE anything is deployed: this is the last point at which "stop" costs
# nothing.
#
#   usage: assert-ancestry.sh <base-ref> <head-ref>
#
# Exit status:
#   0  the base is an ancestor of the head — safe to promote
#   1  it is not, or either ref cannot be resolved
#
# `git` is taken from PATH so a test can run this against a real throwaway repository.
set -euo pipefail

BASE="${1:?base ref required}"
HEAD_REF="${2:?head ref required}"

# Resolve both refs first so an unresolvable one reports as itself rather than as "not an
# ancestor" — which would read as an out-of-date branch and send someone rebasing for no reason.
for ref in "$BASE" "$HEAD_REF"; do
  if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null; then
    echo "::error title=Promotion blocked::cannot resolve ref '${ref}' — a shallow checkout will do this; fetch-depth: 0 is required." >&2
    exit 1
  fi
done

if git merge-base --is-ancestor "$BASE" "$HEAD_REF"; then
  echo "OK    ${BASE} is an ancestor of ${HEAD_REF} — the branch is up to date."
  exit 0
fi

echo "::error title=Promotion blocked::${BASE} is not an ancestor of ${HEAD_REF}; the branch is out of date and must be updated before it can be promoted." >&2
exit 1
