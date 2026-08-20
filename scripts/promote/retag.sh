#!/usr/bin/env bash
#
# Point a new tag at the image digest that served production traffic. Never rebuild.
#
#   usage: retag.sh <image-repo> <digest> <new-tag>
#
# e.g. retag.sh europe-west2-docker.pkg.dev/p/r/design-space-studio sha256:abc... 4f2a9c1
#
# ADR 0007 rejected rebuilding from the merged commit: it would deploy an artefact nothing
# tested, discarding the point of canarying first. So the proven image is retagged onto the
# merged commit instead.
#
# The SOURCE must be a digest. A tag is a mutable pointer, so "retag the image that tag names"
# is a race with anything else that moves it, and the artefact that ships would not provably be
# the artefact that was proven. The digest IS the artefact's identity; the tag is only a
# convenience for finding it.
#
# Idempotent: adding a tag that already points at this digest is the same end state, so a
# re-run after a timeout is safe.
#
# Exit status:
#   0  the tag names the proven digest
#   n  it does not
set -euo pipefail

REPO="${1:?image repo required}"
DIGEST="${2:?digest required}"
NEW_TAG="${3:?new tag required}"

if [[ ! "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "::error title=Retag refused::'${DIGEST}' is not a sha256 digest. Retagging from a mutable tag would ship an artefact that was never proven." >&2
  exit 1
fi

SOURCE="${REPO}@${DIGEST}"
DEST="${REPO}:${NEW_TAG}"

echo "==> tagging ${SOURCE} as ${DEST}"

set +e
OUT="$(gcloud artifacts docker tags add "$SOURCE" "$DEST" --quiet 2>&1)"
RC=$?
set -e

[ -n "$OUT" ] && echo "$OUT"

if [ "$RC" -ne 0 ]; then
  echo "::error title=Retag failed::gcloud exited ${RC}; ${DEST} does not name the proven digest." >&2
  exit "$RC"
fi

echo "OK    ${DEST} now names the proven digest ${DIGEST}."
