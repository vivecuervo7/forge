#!/usr/bin/env bash
# forge-session.sh — ensure a per-Claude-session playwright-cli session exists.
#
# Per-Claude-session state lives at $FORGE_ROOT/runs/$CLAUDE_CODE_SESSION_ID/state.json.
# Reuses an existing run if its playwright-cli daemon is still alive; otherwise sets
# up fresh. Each Claude session gets its own playwright-cli session name and its own
# managed Chrome profile, so concurrent Claude sessions (e.g. across worktrees) don't
# collide on browser state.
#
# Mode is selected by env:
#   FORGE_CDP_PORT=9222   → attach mode (drive the user's existing CDP browser)
#   (unset)               → managed mode (default; launch fresh headed Chrome)
#
# Usage:
#   forge-session.sh                    # ensure session is up
#   forge-session.sh --probe-only       # check only; don't launch
#
# Output: KEY=VALUE lines (FORGE_SESSION, FORGE_PORT, FORGE_MODE, FORGE_PROFILE).
# Human log to stderr.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=$(bash "$SCRIPT_DIR/forge-root.sh")

if [ -z "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  echo "forge-session: CLAUDE_CODE_SESSION_ID is not set; cannot establish a per-session run" >&2
  exit 2
fi

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "forge-session: playwright-cli not on PATH (brew install playwright-cli)" >&2
  exit 5
fi

PROBE_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --probe-only) PROBE_ONLY=true ;;
    *) echo "forge-session: unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Short-id for the playwright-cli session name. Kept to 8 chars because macOS
# caps Unix domain socket paths at 104 bytes (sun_path[104]) and playwright-cli's
# socket path is /var/folders/<2>/<30>/T/pw-<8>/cli/<16hex>-<session-name>.sock —
# leaving roughly 14 chars for the full session name including the 'forge-' prefix.
# 8 hex chars of a UUID give 32 bits of entropy; concurrent collision is effectively impossible.
SHORT_ID="${CLAUDE_CODE_SESSION_ID:0:8}"
RUN_DIR="$ROOT/runs/$CLAUDE_CODE_SESSION_ID"
STATE_FILE="$RUN_DIR/state.json"
PROFILE_DIR="$RUN_DIR/profile"

emit() {
  printf 'FORGE_SESSION=%s\n' "$1"
  printf 'FORGE_PORT=%s\n' "$2"
  printf 'FORGE_MODE=%s\n' "$3"
  printf 'FORGE_PROFILE=%s\n' "$4"
}

# Reuse an existing run if its playwright-cli session is still alive.
if [ -f "$STATE_FILE" ]; then
  EXISTING_NAME=$(sed -nE 's/.*"session":[[:space:]]*"([^"]+)".*/\1/p' "$STATE_FILE" | head -1)
  EXISTING_PORT=$(sed -nE 's/.*"port":[[:space:]]*([0-9]+).*/\1/p'    "$STATE_FILE" | head -1)
  EXISTING_MODE=$(sed -nE 's/.*"mode":[[:space:]]*"([^"]+)".*/\1/p'    "$STATE_FILE" | head -1)
  if [ -n "$EXISTING_NAME" ] && playwright-cli list 2>/dev/null | grep -qE "^- ${EXISTING_NAME}:"; then
    echo "forge-session: reusing run '$EXISTING_NAME' (${EXISTING_MODE:-managed})" >&2
    emit "$EXISTING_NAME" "${EXISTING_PORT:-}" "${EXISTING_MODE:-managed}" "$PROFILE_DIR"
    exit 0
  fi
  # State exists but the daemon is gone — stale; clear it.
  echo "forge-session: clearing stale state for $SHORT_ID (daemon no longer running)" >&2
  rm -f "$STATE_FILE"
fi

if [ "$PROBE_ONLY" = true ]; then
  echo "forge-session: no live session for $SHORT_ID; --probe-only set, not launching" >&2
  exit 1
fi

mkdir -p "$RUN_DIR" "$PROFILE_DIR"

# ATTACH MODE: caller has set FORGE_CDP_PORT to point at an existing CDP browser.
if [ -n "${FORGE_CDP_PORT:-}" ]; then
  if ! curl -sf -m 1 "http://localhost:$FORGE_CDP_PORT/json/version" >/dev/null 2>&1; then
    echo "forge-session: FORGE_CDP_PORT=$FORGE_CDP_PORT but no CDP browser is listening there" >&2
    exit 3
  fi
  SESSION_NAME="forge-attach-$SHORT_ID"
  echo "forge-session: attaching to CDP browser on localhost:$FORGE_CDP_PORT as session '$SESSION_NAME'" >&2
  if ! playwright-cli -s="$SESSION_NAME" attach --cdp "http://localhost:$FORGE_CDP_PORT" >&2; then
    echo "forge-session: attach --cdp failed; browser may not be Chromium-family" >&2
    exit 3
  fi
  cat > "$STATE_FILE" <<EOF
{
  "session": "$SESSION_NAME",
  "mode": "cdp-attached",
  "port": $FORGE_CDP_PORT
}
EOF
  emit "$SESSION_NAME" "$FORGE_CDP_PORT" "cdp-attached" "$PROFILE_DIR"
  exit 0
fi

# MANAGED MODE: launch headed Chrome with a per-run persistent profile. No CDP
# port is exposed — playwright-cli drives the browser directly via the launch
# handle, so two concurrent managed runs don't need (or fight over) ports.
SESSION_NAME="forge-$SHORT_ID"
echo "forge-session: launching managed Chrome (headed) for $SHORT_ID, profile $PROFILE_DIR" >&2
if ! playwright-cli -s="$SESSION_NAME" open --browser=chrome --headed --profile="$PROFILE_DIR" about:blank >&2; then
  echo "forge-session: managed launch failed" >&2
  exit 4
fi
cat > "$STATE_FILE" <<EOF
{
  "session": "$SESSION_NAME",
  "mode": "managed",
  "profile": "$PROFILE_DIR"
}
EOF
emit "$SESSION_NAME" "" "managed" "$PROFILE_DIR"
