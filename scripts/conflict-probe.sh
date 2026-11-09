#!/usr/bin/env bash
# conflict-probe.sh — dry-run merge matrix of the fork's open PRs against upstream.
#
# Nothing is checked out or modified: everything runs through `git merge-tree
# --write-tree` (dry-run, writes a tree object only) plus `git commit-tree`
# for the sequential accumulation probe.
#
# Phases:
#   1. stale check   — does each PR merge cleanly on its target base TODAY?
#   2. pair matrix   — for PRs sharing at least one changed file, do they merge
#                      cleanly into each other? (predicts post-merge rebase pain)
#   3. sequential    — simulate upstream merging all dev-targeted PRs in numeric
#                      order; the first conflict blocks that PR in the chain.
#
# Usage: scripts/conflict-probe.sh [--all | <pr> [<pr>...]]
# Env:   REPO (default SoluceTechnologies/nextcloud-calendar-mobile)
#        AUTHOR (default nonofr91) — only that author's PRs are probed
#        REMOTE_FORK (default fork), REMOTE_UP (default origin)

set -u
cd "$(git rev-parse --show-toplevel)"

REPO=${REPO:-SoluceTechnologies/nextcloud-calendar-mobile}
AUTHOR=${AUTHOR:-nonofr91}
REMOTE_FORK=${REMOTE_FORK:-fork}
REMOTE_UP=${REMOTE_UP:-origin}
TMPDIR_PROBE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_PROBE"' EXIT

# Conflicted paths from merge-tree --write-tree output: the first section lists
# entries as "<mode> <oid> <stage>\t<path>" for unresolved files (stages 1-3).
conflict_files() {
  echo "$1" | grep -E '^[0-9]{6} [0-9a-f]{40} [0-9]	' | cut -f2 | sort -u
}

# ---------- gather PR list ----------
if [ "${1:-}" = "--all" ] || [ $# -eq 0 ]; then
  mapfile -t PRS < <(gh pr list --repo "$REPO" --state open --author "$AUTHOR" \
    --json number,headRefName,baseRefName \
    --jq '.[] | "\(.number)\t\(.headRefName)\t\(.baseRefName)"' | sort -n)
else
  PRS=()
  for n in "$@"; do
    row=$(gh pr view "$n" --repo "$REPO" --json headRefName,baseRefName \
      --jq '"\(.headRefName)\t\(.baseRefName)"') || continue
    PRS+=("$n	$row")
  done
fi
[ ${#PRS[@]} -gt 0 ] || { echo "no PRs to probe"; exit 0; }

declare -A BRANCH BASE FILES
for row in "${PRS[@]}"; do
  n=${row%%	*}; rest=${row#*	}
  BRANCH[$n]=${rest%%	*}; BASE[$n]=${rest#*	}
  b="$REMOTE_FORK/${BRANCH[$n]}"
  if ! git rev-parse --verify --quiet "$b" >/dev/null; then
    echo "WARN: $b not found locally — run: git fetch $REMOTE_FORK" >&2; continue
  fi
  mb=$(git merge-base "$REMOTE_UP/${BASE[$n]}" "$b")
  FILES[$n]=$(git diff --name-only "$mb" "$b" | sort | tr '\n' ' ')
done

echo "== probe scope: ${#PRS[@]} open PRs by $AUTHOR on $REPO =="
echo

# ---------- phase 1: stale check vs target base ----------
echo "── 1) merge on own base (stale check) ──"
declare -A CLEAN_ON_BASE
for row in "${PRS[@]}"; do
  n=${row%%	*}; b="$REMOTE_FORK/${BRANCH[$n]}"
  git rev-parse --verify --quiet "$b" >/dev/null || continue
  out=$(git merge-tree --write-tree "$REMOTE_UP/${BASE[$n]}" "$b" 2>/dev/null)
  if [ $? -eq 0 ]; then
    CLEAN_ON_BASE[$n]=1; printf "  #%-4s %-38s ✅ clean\n" "$n" "${BRANCH[$n]}"
  else
    CLEAN_ON_BASE[$n]=0
    cf=$(conflict_files "$out" | tr '\n' ', ')
    printf "  #%-4s %-38s ❌ CONFLICT: %s\n" "$n" "${BRANCH[$n]}" "${cf%, }"
  fi
done
echo

# ---------- phase 2: pairwise matrix on file overlap ----------
echo "── 2) pairwise probe (only file-overlapping pairs) ──"
nums=$(for r in "${PRS[@]}"; do echo "${r%%	*}"; done)
pairs=0
for a in $nums; do
  for c in $nums; do
    [ "$a" -lt "$c" ] || continue
    [ "${BASE[$a]}" = "${BASE[$c]}" ] || continue
    common=$(comm -12 <(echo ${FILES[$a]} | tr ' ' '\n' | sort -u) \
                    <(echo ${FILES[$c]} | tr ' ' '\n' | sort -u) | tr '\n' ' ')
    [ -n "$common" ] || continue
    pairs=$((pairs+1))
    out=$(git merge-tree --write-tree "$REMOTE_FORK/${BRANCH[$a]}" "$REMOTE_FORK/${BRANCH[$c]}" 2>/dev/null)
    if [ $? -eq 0 ]; then
      printf "  #%s × #%s : ✅ clean   (overlap: %s)\n" "$a" "$c" "$common"
    else
      printf "  #%s × #%s : ❌ CONFLICT (overlap: %s)\n" "$a" "$c" "$common"
      conflict_files "$out" | sed 's/^/      ↳ /'
    fi
  done
done
[ "$pairs" -eq 0 ] && echo "  (no file overlap between any pair — zero predicted conflict)"
echo

# ---------- phase 3: sequential accumulation (numeric order) ----------
echo "── 3) sequential merge simulation on dev (numeric order) ──"
acc="$REMOTE_UP/dev"
for row in "${PRS[@]}"; do
  n=${row%%	*}; b="$REMOTE_FORK/${BRANCH[$n]}"
  [ "${BASE[$n]}" = "dev" ] || { printf "  #%-4s skipped (base=%s)\n" "$n" "${BASE[$n]}"; continue; }
  git rev-parse --verify --quiet "$b" >/dev/null || continue
  out=$(git merge-tree --write-tree "$acc" "$b" 2>/dev/null)
  if [ $? -eq 0 ]; then
    tree=$(echo "$out" | head -1)
    acc=$(git commit-tree "$tree" -p "$acc" -m "probe: merge #$n" -m "by conflict-probe")
    printf "  #%-4s %-38s ✅ merges after previous batch\n" "$n" "${BRANCH[$n]}"
  else
    printf "  #%-4s %-38s ❌ BLOCKED by earlier merges — files:\n" "$n" "${BRANCH[$n]}"
    conflict_files "$out" | sed 's/^/      ↳ /'
    echo "      (skipped in the chain — this PR will need a rebase)"
  fi
done
echo
echo "probe done."
