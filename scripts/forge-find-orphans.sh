#!/usr/bin/env bash
# forge-find-orphans.sh — list forge run dirs whose parent Claude session is
# no longer active. Uses Claude's per-session transcript jsonl mtime
# (~/.claude/projects/<project>/<session-id>.jsonl) as the liveness signal:
# any session whose transcript hasn't been touched in $STALE_MINUTES is
# treated as dead.
#
# Output (one line per orphan):
#   <session-id>\t<playwright-session-name>\t<age-human>
#
# Where age-human is "12m", "3h", "2d" etc. since the Claude transcript was
# last touched (or "no-transcript" if no jsonl was found for this session id).
#
# Excludes the current Claude session ($CLAUDE_CODE_SESSION_ID) so the active
# caller is never listed as an orphan.
#
# Exit 0 always (even with no orphans found). Caller distinguishes via empty
# stdout.

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

  # Only consider runs whose daemon is still live — anything else gets handled
  # by the metadata prune in forge-session.sh.
  if ! printf '%s\n' "$LIVE_SESSIONS" | grep -qxF "$name"; then continue; fi

  # Liveness signal: the Claude session's own transcript jsonl.
  jsonl=$(find "$HOME/.claude/projects" -maxdepth 3 -name "${sid}.jsonl" -type f 2>/dev/null | head -1)
  if [ -z "$jsonl" ]; then
    age_str="no-transcript"
    is_orphan=true
  else
    mtime=$(stat -f %m "$jsonl" 2>/dev/null) || continue
    age=$((NOW - mtime))
    age_str=$(humanize_age "$age")
    [ "$age" -ge "$STALE_SECS" ] && is_orphan=true || is_orphan=false
  fi

  [ "$is_orphan" = true ] && printf '%s\t%s\t%s\n' "$sid" "$name" "$age_str"
done

exit 0
