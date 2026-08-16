#!/usr/bin/env bash
# smoke.sh — exercise the two load-bearing routes against a running studio instance.
#
# Usage:
#   scripts/smoke.sh <BASE_URL> [ID_TOKEN]
#
# BASE_URL    — the scheme+host to test, e.g. https://pr-42---design-space-studio-xxx.europe-west2.run.app
# ID_TOKEN    — optional Google identity token for authenticated-only Cloud Run services.
#               When omitted the requests are sent without an Authorization header, which works
#               against a locally-running container or a public endpoint.
# SMOKE_ID_TOKEN (env) — takes precedence over the positional ID_TOKEN argument so the CI
#               workflow can supply the token through the environment rather than the command
#               line (where it would be echoed to the log).
# SMOKE_JOURNEY (env) — the journey document whose screens must appear in the rendered page.
#               Defaults to the broadband-switch reference journey, which is what the studio
#               serves at /.
# SMOKE_EXPECT_REVISION (env) — when set, /health must report exactly this Cloud Run revision.
#               Unset means no assertion: a container running outside Cloud Run has no revision
#               to report, so requiring one would break local and preview runs.
#
# Exit code: 0 if both checks pass, non-zero otherwise.
# The same script is used by both the preview workflow (2S.3) and the promotion workflow
# (2S.4) — including the promotion's repeated-probe canary observation (observe-canary.sh),
# which shells out to this script once per probe. The two callers differ in more than the
# BASE_URL they point at: promotion also sets SMOKE_EXPECT_REVISION, asserting /health answers
# from the specific candidate revision rather than an incumbent that might still be serving the
# blended traffic split; the preview workflow leaves it unset, since a locally-run or preview
# container has no revision assertion to make.

set -euo pipefail

# Resolved from the script's own location, not the caller's cwd — this is invoked from the repo
# root by CI and from anywhere by a developer, and the journey document must be found in both.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BASE_URL="${1:-}"
# SMOKE_ID_TOKEN (env) takes precedence; fall back to the positional argument for local use.
ID_TOKEN="${SMOKE_ID_TOKEN:-${2:-}}"

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
# Helper: fetch a URL; results are written to the caller-supplied globals
# FETCH_STATUS and FETCH_BODY so we avoid bash-4-only `local -n` namerefs.
# ---------------------------------------------------------------------------
FETCH_STATUS=""
FETCH_BODY=""

fetch() {
  local url="$1"

  # SMOKE_CURL_MAX_TIME overrides the default so tests can use a short timeout
  # without waiting 30 s per request.
  local max_time="${SMOKE_CURL_MAX_TIME:-30}"
  local args=( --silent --show-error --max-time "$max_time" --write-out "%{http_code}" )
  if [[ -n "$AUTH_HEADER" ]]; then
    args+=( --header "$AUTH_HEADER" )
  fi

  # Body written to a temp file; the status code is the last line of stdout.
  local tmp
  tmp="$(mktemp)"
  # Capture curl's exit status explicitly before set -e can act on it, so a
  # connection-level failure (refused, DNS, TLS) is reported in the same shape
  # as an HTTP-status failure rather than killing the script mid-check.
  FETCH_STATUS="$(curl "${args[@]}" --output "$tmp" -- "$url" 2>&1)" || {
    local curl_rc=$?
    FETCH_BODY=""
    rm -f "$tmp"
    # Propagate a sentinel that the status checks below will treat as a failure.
    FETCH_STATUS="curl-error-${curl_rc}"
    return 0
  }
  FETCH_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# Check 1 — GET / returns 200 and contains the reference journey's prompt heading.
# ---------------------------------------------------------------------------
echo "==> smoke: GET ${BASE_URL}/"
fetch "${BASE_URL}/"
if [[ "$FETCH_STATUS" != "200" ]]; then
  echo "FAIL  GET /  expected status 200, got ${FETCH_STATUS}" >&2
  fail=1
else
  echo "OK    GET /  status 200"
fi

# EVERY screen of the reference journey must be present, not merely the first. The expectations
# are DERIVED from the journey document by journey-expectations.mjs, whose own doc-comment is
# the one place that states why (a single hard-coded heading used to be the whole check, which
# journey-smoke-coverage exists to close) — read it there rather than here, so the two do not
# drift apart.
JOURNEY="${SMOKE_JOURNEY:-${SCRIPT_DIR}/../examples/journeys/broadband-switch.json}"

if [[ ! -f "$JOURNEY" ]]; then
  # Fatal rather than falling back to a weaker check. A smoke that quietly narrows its own
  # coverage while still reporting success is the precise failure this replaced.
  echo "FAIL  journey document not found at ${JOURNEY} — refusing to report success against an unknown journey" >&2
  exit 1
fi

if ! EXPECTATIONS="$(node "${SCRIPT_DIR}/journey-expectations.mjs" "$JOURNEY")"; then
  echo "FAIL  could not derive screen expectations from ${JOURNEY}" >&2
  exit 1
fi

while IFS= read -r expected; do
  [[ -z "$expected" ]] && continue
  if [[ "$FETCH_BODY" != *"$expected"* ]]; then
    echo "FAIL  GET /  body does not contain journey screen heading: \"${expected}\"" >&2
    fail=1
  else
    echo "OK    GET /  body contains journey screen heading: \"${expected}\""
  fi
  # A here-string keeps this loop in the current shell, so fail=1 survives it. A pipe would run
  # the loop in a subshell and every failure would be discarded.
done <<< "$EXPECTATIONS"

# ---------------------------------------------------------------------------
# Check 2 — GET /health returns 200 and a JSON payload with status=ok and portVersion.
#
# /healthz is intercepted by Cloud Run's frontend and must never be used here —
# see docs/architecture.md §9a and the README for the evidence from the live service.
# ---------------------------------------------------------------------------
echo "==> smoke: GET ${BASE_URL}/health"
fetch "${BASE_URL}/health"
if [[ "$FETCH_STATUS" != "200" ]]; then
  echo "FAIL  GET /health  expected status 200, got ${FETCH_STATUS}" >&2
  fail=1
else
  echo "OK    GET /health  status 200"
fi

# Confirm the JSON payload carries status=ok (not merely that it is parseable).
if [[ "$FETCH_BODY" != *'"status":"ok"'* ]] && [[ "$FETCH_BODY" != *'"status": "ok"'* ]]; then
  echo "FAIL  GET /health  body does not contain status:ok — got: ${FETCH_BODY}" >&2
  fail=1
else
  echo "OK    GET /health  body contains status:ok"
fi

# Confirm portVersion is present AND in MAJOR.MINOR form. Checking only that the field name
# appears would pass for "portVersion": null or an empty string — and the port version is what
# adapter output is content-addressed on, so a malformed one is worth failing a deploy over.
if [[ ! "$FETCH_BODY" =~ \"portVersion\"[[:space:]]*:[[:space:]]*\"[0-9]+\.[0-9]+\" ]]; then
  echo "FAIL  GET /health  portVersion missing or not MAJOR.MINOR — got: ${FETCH_BODY}" >&2
  fail=1
else
  echo "OK    GET /health  body contains portVersion"
fi

# Which build answered, when the caller knows what it expects. Why portVersion alone cannot
# tell two builds apart, and why the promotion workflow needs this: docs/architecture.md §9a
# ("`/health` says which build answered"). /health echoes Cloud Run's K_REVISION, and this
# asserts it.
if [[ -n "${SMOKE_EXPECT_REVISION:-}" ]]; then
  if [[ ! "$FETCH_BODY" =~ \"revision\"[[:space:]]*:[[:space:]]*\"${SMOKE_EXPECT_REVISION}\" ]]; then
    echo "FAIL  GET /health  expected revision ${SMOKE_EXPECT_REVISION} — got: ${FETCH_BODY}" >&2
    fail=1
  else
    echo "OK    GET /health  answered by revision ${SMOKE_EXPECT_REVISION}"
  fi
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
