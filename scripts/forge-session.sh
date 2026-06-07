#!/usr/bin/env bash
# forge-session.sh — ensure the 'forge' playwright-cli session exists.
#
# Usage:
#   forge-session.sh                    # probe → attach --cdp / open --persistent
#   forge-session.sh --probe-only       # never launch; exit 1 if no session can be established without it
#   forge-session.sh --managed          # skip the CDP probe; always open --persistent
#   forge-session.sh --port=9222        # CDP port to probe
#
# Output: a single line of JSON to stdout describing what mode the session is in.
# Human-facing log lines go to stderr.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=$(bash "$SCRIPT_DIR/forge-root.sh")
PROFILE="$ROOT/chromium-profile"
PROBE_ONLY=false
MANAGED=false
PORT=9222

for arg in "$@"; do
  case "$arg" in
    --probe-only) PROBE_ONLY=true ;;
    --managed) MANAGED=true ;;
    --port=*) PORT="${arg#--port=}" ;;
    *) echo "forge-session: unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "forge-session: playwright-cli not on PATH." >&2
  echo "  Install with: brew install playwright-cli" >&2
  exit 5
fi

emit_json() {
  printf '%s\n' "$1"
}

# Already-running forge session? `playwright-cli list` formats entries as
# `- forge:` so we match on word boundary, not whitespace.
if playwright-cli list 2>/dev/null | grep -qE '\bforge\b'; then
  echo "forge-session: existing 'forge' session found" >&2
  emit_json '{"mode":"existing","session":"forge"}'
  exit 0
fi

# Probe CDP — attach if alive (unless --managed forces a fresh launch).
if [ "$MANAGED" = false ]; then
  if curl -sf -m 1 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
    echo "forge-session: CDP browser detected on localhost:$PORT — attaching" >&2
    if ! playwright-cli -s=forge attach --cdp "http://localhost:$PORT" >&2; then
      echo "forge-session: attach --cdp failed; the browser may not be Chromium-family" >&2
      exit 3
    fi
    emit_json "{\"mode\":\"cdp-attached\",\"session\":\"forge\",\"port\":$PORT}"
    exit 0
  fi
fi

if [ "$PROBE_ONLY" = true ]; then
  echo "forge-session: no CDP browser on localhost:$PORT and --probe-only was set" >&2
  exit 1
fi

# Launch managed Chrome with a dedicated persistent profile. Headed by default —
# browser-automation work is much more useful when you can see what's happening,
# and forge's primary use case is taking-the-reins while the user watches.
echo "forge-session: launching managed Chrome (headed) with profile $PROFILE" >&2
if ! playwright-cli -s=forge open --browser=chrome --headed --profile="$PROFILE" about:blank >&2; then
  echo "forge-session: managed launch failed" >&2
  exit 4
fi
emit_json "{\"mode\":\"launched\",\"session\":\"forge\",\"profile\":\"$PROFILE\"}"
