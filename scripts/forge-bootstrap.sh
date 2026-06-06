#!/usr/bin/env bash
# Idempotently set up the forge data root.
# Safe to run on every invocation — fast no-op when already initialised.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=$(bash "$SCRIPT_DIR/forge-root.sh")

mkdir -p \
  "$ROOT" \
  "$ROOT/scratch" \
  "$ROOT/staged" \
  "$ROOT/library" \
  "$ROOT/broken" \
  "$ROOT/sessions" \
  "$ROOT/chromium-profile"

# stats.json — per-snippet metadata
if [ ! -f "$ROOT/stats.json" ]; then
  echo '{}' > "$ROOT/stats.json"
fi

# INDEX.md — retrieval surface
if [ ! -f "$ROOT/INDEX.md" ]; then
  cat > "$ROOT/INDEX.md" <<'EOF'
# Forge snippet index

Auto-generated. Do not edit by hand — `forge-registry.mjs reindex` regenerates this file.

No snippets yet.
EOF
fi

# Required external tool: playwright-cli. We don't install it — surface the requirement clearly.
if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "forge: playwright-cli is not installed." >&2
  echo "  Install with: brew install playwright-cli" >&2
  echo "  (forge wraps playwright-cli; it cannot drive a browser without it)" >&2
  exit 5
fi

# Emit KEY=VALUE lines for downstream consumers.
printf 'FORGE_ROOT=%s\n' "$ROOT"
printf 'FORGE_PROFILE=%s\n' "$ROOT/chromium-profile"
printf 'FORGE_SESSION=%s\n' 'forge'
printf 'PLAYWRIGHT_CLI=%s\n' "$(command -v playwright-cli)"
