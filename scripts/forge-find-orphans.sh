#!/usr/bin/env bash
# forge-find-orphans.sh — list forge run dirs whose parent Claude session is
# no longer alive.
#
# Primary liveness signal: state.json's parent_claude_pid. If that PID is gone
# (or got reused — verified via `ps -o comm=`), the Claude session is dead.
# This works correctly across idle / suspended / active Claude states, since
# all of those keep the process alive.
#
# Legacy fallback: for state.json files written before 0.7.x (no
# parent_claude_pid recorded), fall back to Claude's per-session transcript
# jsonl mtime — anything stale by $FORGE_ORPHAN_STALE_MINUTES (default 60) is
# treated as an orphan.
#
# Output (one line per orphan):
#   <session-id>\t<playwright-session-name>\t<reason>
#
# Where reason is a short string: "parent-pid-gone", "parent-pid-reused",
# "jsonl-stale 53m", "no-transcript".
#
# Excludes the current Claude session ($CLAUDE_CODE_SESSION_ID).
# Exit 0 always; caller distinguishes via empty stdout.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=$(bash "$SCRIPT_DIR/forge-root.sh")

STALE_MINUTES=${FORGE_ORPHAN_STALE_MINUTES:-60}
STALE_SECS=$((STALE_MINUTES * 60))

[ -d "$ROOT/runs" ] || exit 0

NOW=$(date +%s)
CURRENT="${CLAUDE_CODE_SESSION_ID:-}"

# Live playwright-cli sessions — only orphans with a live daemon are interesting
# to surface (those with no daemon are pure metadata and get pruned by
# forge-session.sh anyway).
LIVE_SESSIONS=$(playwright-cli list 2>/dev/null | awk '/^- / { name=$2; sub(/:$/, "", name); print name }')

humanize_age() {
  local secs=$1
  if   [ "$secs" -lt 60 ];       then echo "${secs}s"
  elif [ "$secs" -lt 3600 ];     then echo "$((secs / 60))m"
  elif [ "$secs" -lt 86400 ];    then echo "$((secs / 3600))h"
  else                                echo "$((secs / 86400))d"
  fi
}

for dir in "$ROOT/runs"/*/; do
  [ -d "$dir" ] || continue
  sid=$(basename "$dir")
  [ "$sid" = "$CURRENT" ] && continue

  state="$dir/state.json"
  [ -f "$state" ] || continue
  name=$(sed -nE 's/.*"session":[[:space:]]*"([^"]+)".*/\1/p' "$state" | head -1)
  [ -z "$name" ] && continue

  # Only consider runs whose daemon is still live.
  if ! printf '%s\n' "$LIVE_SESSIONS" | grep -qxF "$name"; then continue; fi

  # PRIMARY check: parent_claude_pid liveness.
  parent_pid=$(sed -nE 's/.*"parent_claude_pid":[[:space:]]*([0-9]+).*/\1/p' "$state" | head -1)
  if [ -n "$parent_pid" ]; then
    if ! kill -0 "$parent_pid" 2>/dev/null; then
      printf '%s\t%s\t%s\n' "$sid" "$name" "parent-pid-gone"
      continue
    fi
    # PID still alive — verify it's still 'claude' (defends against PID reuse).
    parent_comm=$(ps -o comm= -p "$parent_pid" 2>/dev/null | tr -d ' ')
    if [[ "$parent_comm" != *claude* ]]; then
      printf '%s\t%s\t%s\n' "$sid" "$name" "parent-pid-reused"
      continue
    fi
    # Parent is alive and is claude — not an orphan, even if idle / suspended.
    continue
  fi

  # FALLBACK (legacy runs without parent_claude_pid): jsonl mtime heuristic.
  jsonl=$(find "$HOME/.claude/projects" -maxdepth 3 -name "${sid}.jsonl" -type f 2>/dev/null | head -1)
  if [ -z "$jsonl" ]; then
    printf '%s\t%s\t%s\n' "$sid" "$name" "no-transcript"
  else
    mtime=$(stat -f %m "$jsonl" 2>/dev/null) || continue
    age=$((NOW - mtime))
    if [ "$age" -ge "$STALE_SECS" ]; then
      printf '%s\t%s\t%s\n' "$sid" "$name" "jsonl-stale $(humanize_age "$age")"
    fi
  fi
done

exit 0
