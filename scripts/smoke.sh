#!/usr/bin/env bash
# smoke.sh — exercise the two load-bearing routes against a running studio instance.
#
# Usage:
#   scripts/smoke.sh <BASE_URL> [ID_TOKEN]
#
# BASE_URL  — the scheme+host to test, e.g. https://pr-42---design-space-studio-xxx.europe-west2.run.app
# ID_TOKEN  — optional Google identity token for authenticated-only Cloud Run services.
#             When omitted the requests are sent without an Authorization header, which works
#             against a locally-running container or a public endpoint.
#
# Exit code: 0 if both checks pass, non-zero otherwise.
# The same script is used by the preview workflow (2S.3) and will be reused by the
# promotion workflow (2S.4); pointing it at a different BASE_URL is the only difference.

set -euo pipefail

BASE_URL="${1:-}"
ID_TOKEN="${2:-}"

if [[ -z "$BASE_URL" ]]; then
  echo "usage: $0 <BASE_URL> [ID_TOKEN]" >&2
  exit 1
fi

# Remove trailing slash so every path below is unambiguous.
BASE_URL="${BASE_URL%/}"

# Build the Authorization header once; empty when no token is supplied.
if [[ -n "$ID_TOKEN" ]]; then
  AUTH_HEADER="Authorization: Bearer ${ID_TOKEN}"
else
  AUTH_HEADER=""
fi

fail=0

# ---------------------------------------------------------------------------
# Helper: fetch a URL and return status + body.
# ---------------------------------------------------------------------------
fetch() {
  local url="$1"
  local -n _status_ref="$2"
  local -n _body_ref="$3"

  local args=( --silent --show-error --max-time 30 --write-out "%{http_code}" )
  if [[ -n "$AUTH_HEADER" ]]; then
    args+=( --header "$AUTH_HEADER" )
  fi

  local output
  # Body written to a temp file; the status code is the last line of stdout.
  local tmp
  tmp="$(mktemp)"
  # shellcheck disable=SC2034  # _status_ref is used via nameref
  _status_ref="$(curl "${args[@]}" --output "$tmp" -- "$url" 2>&1)"
  _body_ref="$(cat "$tmp")"
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# Check 1 — GET / returns 200 and contains the reference journey's prompt heading.
# ---------------------------------------------------------------------------
echo "==> smoke: GET ${BASE_URL}/"
status=""
body=""
fetch "${BASE_URL}/" status body
if [[ "$status" != "200" ]]; then
  echo "FAIL  GET /  expected status 200, got ${status}" >&2
  fail=1
else
  echo "OK    GET /  status 200"
fi

# The first screen of the broadband-switch reference journey carries this heading.
# Changing it breaks the rendering contract — a meaningful, non-trivial assertion.
HEADING="Choose a new package"
if [[ "$body" != *"$HEADING"* ]]; then
  echo "FAIL  GET /  body does not contain reference journey heading: \"${HEADING}\"" >&2
  fail=1
else
  echo "OK    GET /  body contains reference journey heading"
fi

# ---------------------------------------------------------------------------
# Check 2 — GET /health returns 200 and a JSON payload with status=ok and portVersion.
#
# /healthz is intercepted by Cloud Run's frontend and must never be used here —
# see docs/architecture.md §9a and the README for the evidence from the live service.
# ---------------------------------------------------------------------------
echo "==> smoke: GET ${BASE_URL}/health"
hstatus=""
hbody=""
fetch "${BASE_URL}/health" hstatus hbody
if [[ "$hstatus" != "200" ]]; then
  echo "FAIL  GET /health  expected status 200, got ${hstatus}" >&2
  fail=1
else
  echo "OK    GET /health  status 200"
fi

# Confirm the JSON payload carries status=ok (not merely that it is parseable).
if [[ "$hbody" != *'"status":"ok"'* ]] && [[ "$hbody" != *'"status": "ok"'* ]]; then
  echo "FAIL  GET /health  body does not contain status:ok — got: ${hbody}" >&2
  fail=1
else
  echo "OK    GET /health  body contains status:ok"
fi

# Confirm the portVersion field is present (MAJOR.MINOR format).
if [[ "$hbody" != *'"portVersion"'* ]]; then
  echo "FAIL  GET /health  body does not contain portVersion field — got: ${hbody}" >&2
  fail=1
else
  echo "OK    GET /health  body contains portVersion"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if [[ "$fail" -eq 0 ]]; then
  echo "smoke: all checks passed"
else
  echo "smoke: one or more checks FAILED" >&2
fi

exit "$fail"
