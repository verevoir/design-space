#!/usr/bin/env bash
# Stamp the reviewed diff's hash beside this lens's verdict — the key the panel's
# memory files the verdict under (see panel-memory.sh for what the memory is for).
#
# A SCRIPT RATHER THAN AN INLINE `run:` BLOCK, for the reason resolve-merge-base.sh
# is one: gate logic inside a `run:` block cannot be unit-tested, so its guards are
# pinned only by whatever the YAML shape tests can see from the outside — step
# ordering and
# the presence of a literal. MOST OF WHAT FOLLOWS is degradation paths that never
# fire on a healthy run — an unresolved merge base, a bad range bound, an unusable
# timeout, a failed `git diff`, a failed hash — which is exactly the code a shape
# test cannot reach and exactly the code that must not silently stop working. Here
# they are ordinary shell with an ordinary test file, and each has a test.
#
# The list is deliberately not COUNTED. It was, and the number went stale three
# times in three rounds as branches were added — a comment stating a checkable
# figure about the file it sits in is a standing invitation to be wrong, and the
# figure was never the useful part.
#
# WHAT IT GUARANTEES, and why each one is load-bearing:
#
#  - THE FILE IS CLEARED FIRST. A panelist holds Write and runs before this does, so
#    it can put anything it likes in diff-hash.txt. The ordering in the workflow (this
#    runs after the model) is what stops a lens choosing which diff its verdict is
#    remembered against — but ordering alone only holds on the SUCCESS path: every
#    early exit below would otherwise leave the panelist's file in place to be
#    uploaded with the verdict. Clearing before the first guard is what makes the
#    guarantee unconditional.
#
#  - LC_ALL=C. `case "$sha" in *[!0-9a-f]*)` is a COLLATION test, not a byte test:
#    under a locale that interleaves case — macOS's default is one — 'A' sorts inside
#    a-f and the guard ACCEPTS a non-hex string. resolve-merge-base.sh carries a header
#    about this as a confirmed defect. Setting it here rather than trusting the caller
#    makes the check a property of this script.
#
#  - THE DIFF IS WRITTEN TO A FILE BEFORE IT IS HASHED. `git diff | sha256sum` in a
#    `bash -e` context without pipefail would record the hash of empty input when the
#    diff failed — a stable, confident, WRONG key that reads back as "the panel judged
#    this before". The hash is taken only after a diff that actually succeeded.
#
# DEGRADES, NEVER GATES. Every failure path exits 0 having written no hash: this lens
# then contributes nothing to the memory, the verdict still uploads, and the gate still
# decides. A memory that could block a merge would be a worse thing than no memory.
#
# usage: BASE_SHA=... HEAD_SHA=... LENS=... stamp-diff-hash.sh <out-dir> <diff-file>
set -euo pipefail
export LC_ALL=C

out_dir="${1:?usage: stamp-diff-hash.sh <out-dir> <diff-file>}"
diff_file="${2:?usage: stamp-diff-hash.sh <out-dir> <diff-file>}"
base_sha="${BASE_SHA:-}"
head_sha="${HEAD_SHA:-}"
# Reduced to the lens alphabet before it is ever echoed, exactly as panel-memory.sh
# does with the same value. It arrives from the workflow matrix, which is base-branch
# config and so not attacker-controlled today — but the two scripts read the same
# input and print it to the same log, and one of them defending while the other does
# not is the kind of asymmetry that survives right up until the matrix becomes
# configurable. `tr -cd` under the LC_ALL=C above, so the ranges are bytes.
lens="$(printf '%s' "${LENS:-lens}" | tr -cd 'a-z0-9-')"
[ -n "$lens" ] || lens=lens

# BEFORE any guard below can return. See the header: this is the line that makes
# "the gate's hash is the last word on this file" true on every path rather than
# only on the one where nothing went wrong.
# THE DIRECTORY FIRST, because protecting only the leaf paths traces the threat
# halfway. The panelist is told to create `.antagonistic-review` itself, so it can
# put a SYMLINK there instead — and `mkdir -p` follows one silently, after which
# every careful thing below writes into a directory of the planter's choosing.
# Replacing a symlinked dir is safe here: this script owns the path, and anything
# already at it either came from the panelist or is ours to overwrite.
[ -L "$out_dir" ] && rm -f "$out_dir"
mkdir -p "$out_dir"
rm -f "$out_dir/diff-hash.txt"

# BOTH OUTPUT PATHS ARE FIXED AND PREDICTABLE, and the panelist that runs
# immediately before this step holds Bash and Write. A plain `>` redirect FOLLOWS a
# symlink, so a link planted at either path would have this script's output written
# through it to a destination of the planter's choosing — and the refuter downstream
# would then accept quotes from a file this step did not author.
#
# `rm -f` ALONE IS NOT THE FIX, which is what an earlier shape here assumed: between
# the unlink and the redirect there is a window in which the link can be planted
# again. So neither path is written directly. Each is composed in a private temp
# file — `mktemp` in a directory this script creates, so the NAME is not predictable
# — and moved into place with `mv`, which replaces a symlink sitting at the target
# rather than writing through it. Same discipline the ledger already uses, and the
# same reason the workflow strips author-planted symlinks out of the PR-head extract.
rm -f "$diff_file"

# Cleaned up on every exit path, including the degradations that exit 0 below.
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

if [ -z "$base_sha" ]; then
  echo "no resolved merge base — this lens contributes nothing to the panel's memory"
  exit 0
fi

# Bare lowercase hex only, both bounds, before either is handed to git.
for sha in "$base_sha" "$head_sha"; do
  case "$sha" in
    '' | *[!0-9a-f]*)
      echo "non-sha range bound — skipping the memory key"
      exit 0
      ;;
  esac
done

# NO `timeout`, NO DIFF. An earlier shape here fell back to a bare `git diff` when
# coreutils was absent, on the reasoning that the bound only matters on a runner and
# a dev machine should not be blocked by a missing nicety. That trade is the wrong
# way round: it swaps a fast, bounded failure for an UNBOUNDED call, and it does so
# on exactly the hosts where nobody is watching a job timer. Every other branch here
# degrades to "this lens contributes no key"; running unbounded is the one
# degradation that can hang instead.
#
# So an absent `timeout` is just another degradation: say so, write no hash, exit 0.
# The gate still decides and this lens simply does not vote in the memory.
if ! command -v timeout >/dev/null 2>&1; then
  echo "no bounded timeout available — this lens contributes nothing to the panel's memory"
  exit 0
fi

# Env-overridable so a test can drive the bound without hanging for a real minute —
# the same reason panel-memory.sh exposes its eviction cap. Validated as digits,
# because it is interpolated into a command line.
diff_timeout="${DIFF_TIMEOUT_SECONDS:-60}"
# Digits, and NOT ZERO. `timeout 0 cmd` is documented as "no time limit" — GNU
# coreutils runs it unbounded — so a digits-only check admits the single value that
# defeats the guarantee this whole branch exists to give, and it would read as a
# perfectly ordinary configuration. Leading zeros are refused with it: `00` is the
# same hole spelled differently, and no legitimate caller writes one.
case "$diff_timeout" in
  '' | *[!0-9]* | 0*)
    echo "DIFF_TIMEOUT_SECONDS is not a positive whole number of seconds — this lens contributes nothing to the panel's memory"
    exit 0
    ;;
esac

diff_ok() { timeout "$diff_timeout" git diff "$base_sha...$head_sha"; }

if ! diff_ok >"$work_dir/reviewed.diff"; then
  echo "could not materialise the reviewed diff — this lens contributes nothing to the panel's memory"
  exit 0
fi
# rename(2), so a symlink re-planted at the target is REPLACED, not followed.
mv -f "$work_dir/reviewed.diff" "$diff_file"

# Computed into a variable, and the file written only if that worked. The script
# runs under `set -o pipefail`, so `sha256sum <f | cut >out` would exit non-zero if
# either half failed — breaking the exits-0-always promise on the one path nothing
# else guards, and leaving a truncated hash file behind while doing it.
if ! hash_value="$(sha256sum <"$diff_file" | cut -d' ' -f1)" || [ -z "$hash_value" ]; then
  echo "could not hash the reviewed diff — this lens contributes nothing to the panel's memory"
  exit 0
fi
printf '%s\n' "$hash_value" >"$work_dir/diff-hash.txt"
mv -f "$work_dir/diff-hash.txt" "$out_dir/diff-hash.txt"
echo "memory key for ${lens}: $(printf '%s' "$hash_value" | cut -c1-12)"
