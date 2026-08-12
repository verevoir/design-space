#!/usr/bin/env bash
# PANEL MEMORY — does the panel judge the SAME diff the same way twice?
#
# The corpus frame every lens is handed says outright that identical input must
# yield an identical verdict ("Reporting only evidenced, anchored findings makes
# the verdict a function of the change, so identical input yields an identical
# verdict"). In practice it does not always: a comment-only push has flipped
# `correctness` and `testing` from APPROVE to REJECT, and lenses have rejected
# code they approved the round before. Today that is INVISIBLE — a flip on an
# unchanged diff and a genuine new finding read exactly alike in the log, so the
# flip costs a round AND quietly erodes what a green is worth.
#
# This script gives the CI panel the memory the LOCAL pre-gate already has
# (capabilities' `src/pre-gate/ledger.ts` — findings persisted per branch against
# diff hashes so
# a re-run VERIFIES rather than rediscovers). It records, per PR, which verdict
# each lens returned for each reviewed diff HASH, and when a lens returns a
# DIFFERENT verdict for a hash it has already judged it says so in its own
# words — a GATE EVENT, not a finding:
#
#   correctness: this diff (a1b2c3d4e5f6) previously APPROVED; it now REJECTS.
#
# WHY THIS NEVER CHANGES THE GATE'S ANSWER. A flip is a defect of the PANEL, not
# of the change, and blocking on one helps in neither direction: an
# APPROVE->REJECT flip already blocks through the ordinary path, and failing a
# REJECT->APPROVE flip would make a recovered green unreachable — a change could
# never come back from a spurious reject. So this prints, exits 0 always, and
# `aggregate.sh` remains the sole decider. The value is that a stable annotation
# title turns an anecdote into a rate somebody can measure.
#
# WHAT IS NEVER RECORDED. Diff CONTENT (hashes only — the same discipline
# capabilities' ledger.ts states: a dirty tree's text must not land anywhere) and finding TEXT
# (model-written from an adversarial diff; nothing here needs it). A run in
# which NO lens produced a usable verdict records NOTHING — a review that did
# not happen must not leave a record claiming it did. That is the local ledger's
# rule (capabilities' `applyLensRun`: a PARSE-FAILURE or TIMEOUT touches nothing) carried into
# CI, and it holds per lens too: a lens that died contributes no judgement, while
# its surviving colleagues still record theirs.
#
# TRUST — and precisely what kind. A panelist holds Write, so it CAN write to
# diff-hash.txt; the defence is not that the file is unwritable but that the
# workflow's "Stamp the reviewed diff's hash" step runs AFTER the model and
# OVERWRITES it. Whatever key a lens might try to choose is discarded before the
# artifact is published, so it cannot have its verdict remembered against a diff
# nobody reviewed. Stated as the enforcement it is, not as an impossibility, so
# nobody later reads the shorter toolbelt as making the write impossible and
# moves the stamp step earlier. Only APPROVE / REJECT and a
# 64-hex hash are ever read out of the artifacts; the model-written summary and
# findings are not echoed at all, so the workflow-command injection surface
# `aggregate.sh` has to defend against does not exist here.
#
# usage: panel-memory.sh <verdicts-dir> <ledger-path>
set -euo pipefail

# NOT COSMETIC, and the same bug resolve-merge-base.sh carries a header about.
# `case "$h" in *[!0-9a-f]*)` is a COLLATION test, not a byte test: under a locale
# that interleaves case — macOS's default is one — 'A' sorts inside a-f, so the
# guard accepts a string that is not lowercase hex. This script is explicitly
# written to run outside the CI runner too (the env-overridable knobs exist so a
# test can drive the eviction), so a locale-dependent guard is a live gap here and
# not a theoretical one. Pinning the whole script rather than the single `tr` below
# means a guard added later inherits the protection instead of having to remember.
export LC_ALL=C

dir="${1:?usage: panel-memory.sh <verdicts-dir> <ledger-path>}"
ledger="${2:?usage: panel-memory.sh <verdicts-dir> <ledger-path>}"

# Created up front, not at the write: several paths below record nothing (a run
# where no lens judged, lenses that disagree about the diff), and the workflow's
# cache-save step errors on a path that does not exist. A run that correctly
# declined to record would otherwise fail its own save and look like a fault.
mkdir -p "$(dirname "$ledger")"

# Bound on stored entries — the memory is bounded, not infinite, exactly as
# capabilities' MAX_LAP_ENTRIES bounds the local lap ledger. Past it the OLDEST entries are
# dropped: a flip is only interesting against a diff hash still being pushed, and
# an entry is ~200 bytes, so a long-lived PR costs kilobytes. Env-overridable so
# a test can drive the eviction without writing 50 fixtures.
max_entries="${PANEL_MEMORY_MAX_ENTRIES:-50}"

# Anything read out of a verdict artifact is model-adjacent; bound every jq parse
# so a pathological payload degrades the memory rather than holding the step to
# its timeout.
#
# AND NO BOUND MEANS NO RUN. A bare-jq fallback stood here for hosts without
# coreutils, which is the wrong way round for the same reason stamp-diff-hash.sh
# rejects it: it swaps a fast, bounded failure for an UNBOUNDED parse of
# panelist-controlled JSON, on precisely the hosts where no job timer is watching.
# This script's whole contract is that it reports and never gates — so an absent
# `timeout` is just one more thing to report and decline, not a licence to run the
# parse anyway.
if ! command -v timeout >/dev/null 2>&1; then
  echo "no bounded timeout available — the panel's memory records nothing this run"
  exit 0
fi
# Digits, and NOT ZERO, for the reason stamp-diff-hash.sh states at its own bound:
# `timeout 0 cmd` means "no time limit", so a value that looks like configuration
# silently removes the bound on every parse of panelist-controlled JSON below.
jq_timeout="${JQ_BOUNDED_TIMEOUT:-10}"
case "$jq_timeout" in
  '' | *[!0-9]* | 0*)
    echo "JQ_BOUNDED_TIMEOUT is not a positive whole number of seconds — the panel's memory records nothing this run"
    exit 0
    ;;
esac
jq_bounded() { timeout "$jq_timeout" jq "$@"; }

# A verdict is a small JSON object and the ledger is a small JSON array; anything
# over 1MB is a path gone wrong, and the read is capped at 1MB+1 so size is
# decided without ever consuming an unbounded stream (aggregate.sh's bound, same
# reasoning).
too_big() { [ "$(head -c 1000001 "$1" | wc -c)" -gt 1000000 ]; }

echo "## Panel memory — has this diff been judged before?"

# ---------------------------------------------------------------------------
# Collect (lens, verdict, hash) for every lens that actually judged this run.
# A lens missing either half contributes nothing: without a verdict it did not
# review, and without the workflow's hash there is no key to remember it under.
# ---------------------------------------------------------------------------
judged="$(mktemp)"
trap 'rm -f "$judged"' EXIT

for d in "$dir"/verdict-*/; do
  [ -e "$d" ] || continue
  lens="$(basename "$d")"
  lens="${lens#verdict-}"
  # The directory name comes from the base workflow's matrix, not from a
  # panelist — but it is the one value here that is not a fixed token, so reduce
  # it to the lens alphabet before it is ever printed (aggregate.sh's drift-guard
  # precedent: a crafted name carrying a newline could otherwise emit a
  # line-starting `::` command of its own). LC_ALL=C pins tr's ranges to ASCII.
  lens="$(printf '%s' "$lens" | LC_ALL=C tr -cd 'a-z0-9-')"
  [ -n "$lens" ] || continue

  verdict_file="$d/verdict.json"
  hash_file="$d/diff-hash.txt"
  [ -f "$verdict_file" ] && [ -f "$hash_file" ] || continue
  too_big "$verdict_file" && continue

  v="$(jq_bounded -r '.verdict // empty' "$verdict_file" 2>/dev/null || echo '')"
  # Only the two real verdicts are a judgement. A missing, malformed, or
  # anything-else value means this lens did not deliver one — and an unrecognised
  # string is never echoed, so a crafted verdict field cannot reach the log.
  case "$v" in
  APPROVE | REJECT) ;;
  *) continue ;;
  esac

  h="$(head -c 200 "$hash_file" | tr -d '[:space:]')"
  case "$h" in *[!0-9a-f]*) continue ;; esac
  [ "${#h}" -eq 64 ] || continue

  printf '%s %s %s\n' "$lens" "$v" "$h" >>"$judged"
done

if [ ! -s "$judged" ]; then
  echo "No lens produced both a verdict and a diff hash — recording nothing."
  echo "A review that did not happen must not leave a record claiming it did."
  exit 0
fi

# Every lens hashes the same merge-base..head range, so disagreement means the
# range itself moved under the panel (or a stamp step failed open). There is no
# single diff this run judged, so there is no honest key to file it under.
hashes="$(cut -d' ' -f3 "$judged" | sort -u)"
if [ "$(printf '%s\n' "$hashes" | wc -l)" -ne 1 ]; then
  echo "::warning title=Panel memory unusable::The lenses reported different diff hashes — they did not all review the same change. Recording nothing for this run."
  exit 0
fi
diff_hash="$hashes"
short_hash="${diff_hash:0:12}"

# ---------------------------------------------------------------------------
# Load the prior memory. A missing, oversize, or malformed ledger degrades to an
# empty one: a corrupt memory costs the memory, never the run (capabilities' parseLedger's
# posture, in bash).
# ---------------------------------------------------------------------------
prior='{"version":1,"entries":[]}'
if [ -f "$ledger" ] && ! too_big "$ledger"; then
  loaded="$(jq_bounded -c 'select(.version == 1 and (.entries | type) == "array") | {version: 1, entries: .entries}' "$ledger" 2>/dev/null || echo '')"
  [ -n "$loaded" ] && prior="$loaded"
fi

# ---------------------------------------------------------------------------
# The determinism check: for each lens, what did it say about THIS hash before?
# ---------------------------------------------------------------------------
# APPROVE/REJECT are the wire vocabulary; these are the two forms the sentence
# needs. Spelled out rather than suffixed, because "REJECTD" is the kind of
# detail that makes a reader distrust the whole annotation.
past() { case "$1" in APPROVE) echo "APPROVED" ;; *) echo "REJECTED" ;; esac; }
present() { case "$1" in APPROVE) echo "APPROVES" ;; *) echo "REJECTS" ;; esac; }

flips=0
verified=0
while read -r lens v _; do
  was="$(printf '%s' "$prior" | jq_bounded -r --arg h "$diff_hash" --arg l "$lens" \
    '[.entries[]? | select(.diffHash == $h) | .verdicts[$l]? // empty] | last // empty' 2>/dev/null || echo '')"
  case "$was" in
  APPROVE | REJECT) ;;
  *) continue ;;
  esac
  verified=$((verified + 1))
  [ "$was" = "$v" ] && continue
  flips=$((flips + 1))
  # The wording is the point. "correctness rejected" reads as a finding about the
  # change; "this diff previously APPROVED, it now REJECTS" reads as what it is —
  # the panel contradicting itself about text that did not move. The title is
  # fixed so these are countable across runs.
  echo "::warning title=Panel non-determinism::${lens}: this diff (${short_hash}) previously $(past "$was"); it now $(present "$v"). The change did not move — the panel did."
  echo "  ${lens}: previously ${was}, now ${v} on the SAME diff (${short_hash})"
done <"$judged"

if [ "$flips" -eq 0 ]; then
  if [ "$verified" -eq 0 ]; then
    echo "First review of this diff (${short_hash}) — no prior verdict to check against."
  else
    echo "${verified} lens judgement(s) on this diff (${short_hash}) match what the panel said last time."
  fi
else
  echo "${flips} of ${verified} prior lens judgement(s) on this diff (${short_hash}) FLIPPED — the panel is not deciding this change deterministically."
fi

# ---------------------------------------------------------------------------
# Record this run. Append-only: an entry, once written, is never rewritten (the
# audit-trail posture the lap ledger states), and the tail is bounded.
# ---------------------------------------------------------------------------
# `add // {}`, not a bare `add`: jq's `add` over an EMPTY array is `null`, and
# `null` is a four-character string the emptiness guard below would wave straight
# through into `--argjson v` — writing `"verdicts": null` and silently breaking
# every later lookup for that entry. The `[ ! -s "$judged" ]` guard makes the
# empty case unreachable today; this makes it harmless if a future path reaches it.
verdicts="$(cut -d' ' -f1,2 "$judged" | jq_bounded -R -s -c \
  'split("\n") | map(select(length > 0) | split(" ")) | map({(.[0]): .[1]}) | add // {}' 2>/dev/null || echo '')"
if [ -z "$verdicts" ]; then
  echo "::warning title=Panel memory not updated::This run's verdicts could not be encoded — the next run has one less round of memory."
  exit 0
fi

updated="$(printf '%s' "$prior" | jq_bounded -c \
  --arg h "$diff_hash" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson v "$verdicts" \
  --argjson cap "$max_entries" \
  '.entries += [{diffHash: $h, at: $at, verdicts: $v}] | .entries |= (if (length > $cap) then .[length - $cap:] else . end)' 2>/dev/null || echo '')"
if [ -z "$updated" ]; then
  echo "::warning title=Panel memory not updated::The ledger could not be rewritten — the next run has one less round of memory."
  exit 0
fi

# Write via a temp file in the ledger's own directory, then rename: a
# half-written ledger is the one shape that would silently poison every later
# run, and losing the memory is recoverable where corrupting it is not. The temp
# joins the trap because `set -e` aborts here on a full disk, between the write
# and the rename — the ledger survives that, but the orphan would otherwise be
# left behind on exactly the runs where disk is already the problem.
tmp="$(mktemp "$(dirname "$ledger")/.ledger.XXXXXX")"
trap 'rm -f "$judged" "$tmp"' EXIT
printf '%s\n' "$updated" >"$tmp"
mv "$tmp" "$ledger"
echo "panel memory: recorded $(wc -l <"$judged" | tr -d ' ') lens judgement(s) against ${short_hash}."
