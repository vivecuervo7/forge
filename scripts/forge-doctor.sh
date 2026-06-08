#!/usr/bin/env bash
# /forge doctor: read-only checklist of the forge plugin's install state.
set -uo pipefail

ok="✓"; fail="✗"; warn="?"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=$(bash "$SCRIPT_DIR/forge-root.sh")

echo "Forge plugin doctor"
echo "====================="

if [ -d "$ROOT" ]; then
  echo "$ok Data root exists at $ROOT"
else
  echo "$warn Data root not initialised at $ROOT — will be created on first use"
fi

for tier in scratch staged library broken; do
  if [ -d "$ROOT/$tier" ]; then
    count=$(find "$ROOT/$tier" -maxdepth 1 -name '*.ts' -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "$ok $tier/ — $count snippet(s)"
  else
    echo "$warn $tier/ missing — bootstrap will create it"
  fi
done

if [ -d "$ROOT/hints" ]; then
  count=$(find "$ROOT/hints" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    names=$(find "$ROOT/hints" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort | xargs -I{} basename {} .md | tr '\n' ' ')
    echo "$ok hints/ — $count file(s) active: $names"
  else
    echo "  hints/ present but empty (standalone forge behaviour)"
  fi
else
  echo "  hints/ absent (standalone forge behaviour — no domain hints applied)"
fi

if command -v playwright-cli >/dev/null 2>&1; then
  echo "$ok playwright-cli on PATH: $(command -v playwright-cli)"
else
  echo "$fail playwright-cli not installed"
  echo "    Remedy: brew install playwright-cli"
fi

# Per-Claude-session runs. Active = state.json present AND its session name
# still listed by playwright-cli. Stale = state.json present but daemon gone.
if [ -d "$ROOT/runs" ]; then
  active=0; stale=0
  current_status="not initialised for this Claude session"
  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    sid=$(basename "$dir")
    state="$dir/state.json"
    [ -f "$state" ] || continue
    name=$(sed -nE 's/.*"session":[[:space:]]*"([^"]+)".*/\1/p' "$state" | head -1)
    mode=$(sed -nE 's/.*"mode":[[:space:]]*"([^"]+)".*/\1/p' "$state" | head -1)
    if [ -n "$name" ] && command -v playwright-cli >/dev/null 2>&1 && \
       playwright-cli list 2>/dev/null | grep -qE "^- ${name}:"; then
      active=$((active+1))
      [ "${CLAUDE_CODE_SESSION_ID:-}" = "$sid" ] && current_status="active as '$name' ($mode)"
    else
      stale=$((stale+1))
      [ "${CLAUDE_CODE_SESSION_ID:-}" = "$sid" ] && current_status="stale state for this Claude session (daemon gone)"
    fi
  done < <(find "$ROOT/runs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
  echo "$ok runs/ — $active active, $stale stale"
  echo "  current Claude session: $current_status"
  if [ "$stale" -gt 0 ]; then
    echo "  (clean up stale runs by removing their dir under $ROOT/runs/)"
  fi
else
  echo "  runs/ absent (no per-session browser launched yet)"
fi

if [ -n "${FORGE_CDP_PORT:-}" ]; then
  if curl -sf -m 1 "http://localhost:$FORGE_CDP_PORT/json/version" >/dev/null 2>&1; then
    echo "$ok FORGE_CDP_PORT=$FORGE_CDP_PORT set; CDP browser is listening (attach mode active)"
  else
    echo "$fail FORGE_CDP_PORT=$FORGE_CDP_PORT set, but nothing is listening there"
  fi
else
  echo "  FORGE_CDP_PORT unset → managed mode by default (each Claude session launches its own Chrome)"
fi
