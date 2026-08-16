#!/usr/bin/env bash
# observe-canary.sh — repeated probes of the candidate over a short dwell, before the remaining
# 90% of traffic is cut to it.
#
# ADR 0007 stages the cut specifically because a health check against live traffic is "the only
# step in this sequence that observes real traffic hitting the new revision" — but a single,
# instantaneous probe, fired the moment the 10% cut lands, does not observe anything: it proves
# the candidate answered ONE request at ONE instant. Anything that develops from serving real
# traffic over time — a connection pool exhausting, memory pressure building, a slow leak — has
# no window in which to surface before the cut goes to 100%.
#
# This runs the SAME probe (scripts/smoke.sh, against the candidate's own tag URL — never the
# blended service url, for the reason recorded in promote.yml's health-check step and the ADR
# 0007 amendment of 2026-08-14) several times, spaced out, and stops the promotion on the FIRST
# failure rather than averaging or retrying. A candidate that answers most probes and fails one
# is not "mostly healthy" — this fails closed, the same stance every other decision point in
# scripts/promote/ takes (assert-authorized.sh, wait-for-green.sh, checks-green.mjs).
#
# What this still does NOT prove, stated as plainly as the amendment states it for the
# single-probe version it replaces: every probe here hits the candidate's OWN tag url, never the
# blended service url, so this never observes the blend either — it observes the CANDIDATE,
# repeatedly, for the duration real users are already being served by it. That is a narrowing of
# the gap the amendment describes, not a closure of it. The true fix recorded in ADR 0007's
# "Trigger to revisit" — telemetry comparing the canary's error rate and latency against the
# incumbent's baseline over the same window — still does not exist; this only widens the time a
# probe-based check gets to notice something a single instant cannot.
#
# Usage:
#   scripts/promote/observe-canary.sh <TAG_URL>
#
# Reads SMOKE_ID_TOKEN / SMOKE_EXPECT_REVISION from the environment and forwards them to each
# probe unchanged, by not touching them at all — smoke.sh already reads both directly from its
# own environment, so this script does not need to know their names to pass them through.
#
# CANARY_OBSERVE_PROBES      (default 5)  — how many probes across the dwell, including the
#                                            first, fired immediately once traffic is cut.
# CANARY_OBSERVE_INTERVAL_S  (default 15) — seconds slept BEFORE each probe after the first, so
#                                            dwell length = INTERVAL_S * (PROBES - 1). Defaults
#                                            to a 60-second window: long enough to be more than
#                                            an instant, short enough that the step's own bound
#                                            (promote.yml) covers the worst case with margin.
# CANARY_OBSERVE_SMOKE       — overridable path to the probe script, so tests can point this at
#                                            a disposable stub rather than scripts/smoke.sh and
#                                            the real network calls it makes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TAG_URL="${1:-}"
if [[ -z "$TAG_URL" ]]; then
  echo "usage: $0 <TAG_URL>" >&2
  exit 1
fi

PROBES="${CANARY_OBSERVE_PROBES:-5}"
INTERVAL_S="${CANARY_OBSERVE_INTERVAL_S:-15}"
SMOKE="${CANARY_OBSERVE_SMOKE:-${SCRIPT_DIR}/../smoke.sh}"

if ! [[ "$PROBES" =~ ^[0-9]+$ ]] || [[ "$PROBES" -lt 1 ]]; then
  echo "observe-canary: CANARY_OBSERVE_PROBES must be a positive integer, got '${PROBES}'" >&2
  exit 1
fi
if ! [[ "$INTERVAL_S" =~ ^[0-9]+$ ]]; then
  echo "observe-canary: CANARY_OBSERVE_INTERVAL_S must be a non-negative integer, got '${INTERVAL_S}'" >&2
  exit 1
fi

WINDOW=$(( INTERVAL_S * (PROBES - 1) ))
echo "observe-canary: probing the candidate ${PROBES} time(s) over a ${WINDOW}s dwell (every ${INTERVAL_S}s) before the remaining traffic is cut"

for (( i=1; i<=PROBES; i++ )); do
  if (( i > 1 )); then
    sleep "$INTERVAL_S"
  fi
  echo "observe-canary: probe ${i}/${PROBES}"
  if ! bash "$SMOKE" "$TAG_URL"; then
    PASSED=$(( i - 1 ))
    echo "observe-canary: probe ${i}/${PROBES} FAILED — stopping rather than cutting the remaining traffic. A candidate that answered ${PASSED} probe(s) and failed the next is not 'mostly healthy'." >&2
    exit 1
  fi
done

echo "observe-canary: all ${PROBES} probes over ${WINDOW}s succeeded"
