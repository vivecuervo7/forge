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

if command -v playwright-cli >/dev/null 2>&1 && \
   playwright-cli list 2>/dev/null | grep -qE '\bforge\b'; then
  echo "$ok 'forge' playwright-cli session is active"
else
  echo "  'forge' session not active (will be established on first use via forge-session.sh)"
fi

if curl -sf -m 1 http://localhost:9222/json/version >/dev/null 2>&1; then
  echo "$ok A CDP-enabled browser is currently listening on localhost:9222 (attach will use it)"
else
  echo "  No CDP browser on localhost:9222 (managed Chrome will be launched on demand)"
fi
