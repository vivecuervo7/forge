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
  "$ROOT/runs" \
  "$ROOT/specs" \
  "$ROOT/runner"

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

# Runner workspace: a minimal Playwright project used by `forge-spec.mjs run`
# to execute generated specs without requiring a host project setup. Bootstrap
# the package.json + config on first run, then install @playwright/test if
# node_modules is missing. Browsers (~/Library/Caches/ms-playwright/) are
# shared with playwright-cli, so no extra download is needed in the common case.
if [ ! -f "$ROOT/runner/package.json" ]; then
  cat > "$ROOT/runner/package.json" <<'EOF'
{
  "name": "forge-spec-runner",
  "private": true,
  "description": "Forge-managed Playwright workspace for running generated specs. Not for editing — forge-bootstrap.sh maintains this directory.",
  "dependencies": {
    "@playwright/test": "^1.49.0"
  }
}
EOF
fi

if [ ! -f "$ROOT/runner/playwright.config.ts" ]; then
  cat > "$ROOT/runner/playwright.config.ts" <<'EOF'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '../specs',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: false,
    trace: 'on-first-retry',
  },
})
EOF
fi

# Install runner dependencies on first use (idempotent on subsequent calls).
if [ ! -d "$ROOT/runner/node_modules/@playwright/test" ]; then
  echo "forge: installing @playwright/test into $ROOT/runner/ (first-time, ~30s)…" >&2
  (cd "$ROOT/runner" && npm install --silent --no-audit --no-fund --no-progress) >&2 || {
    echo "forge: npm install failed in $ROOT/runner/ — generated specs will be unrunnable until this is fixed" >&2
  }
fi

# When `npx playwright test` executes a spec at $ROOT/specs/<x>.spec.ts, Node
# resolves `import '@playwright/test'` by walking up from the spec's directory.
# specs/ has no node_modules of its own, so the import would fail. Symlink the
# runner's node_modules into specs/ so resolution finds it.
if [ -d "$ROOT/runner/node_modules" ] && [ ! -e "$ROOT/specs/node_modules" ]; then
  ln -s "$ROOT/runner/node_modules" "$ROOT/specs/node_modules"
fi

# Emit KEY=VALUE lines for downstream consumers. FORGE_SESSION / FORGE_PORT /
# FORGE_MODE / FORGE_PROFILE come from forge-session.sh (per-Claude-session) once
# the browser is established — this script only emits the root + tool location.
printf 'FORGE_ROOT=%s\n' "$ROOT"
printf 'PLAYWRIGHT_CLI=%s\n' "$(command -v playwright-cli)"
