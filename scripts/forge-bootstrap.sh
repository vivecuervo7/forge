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
# to execute generated specs without requiring a host project setup. The
# package.json is plugin-owned (see its own description) — we overwrite on
# every bootstrap so dep additions/version bumps land on existing installs
# without users needing to manually clean their runner. Browsers
# (~/Library/Caches/ms-playwright/) are shared with playwright-cli, so no
# extra download is needed in the common case.
cat > "$ROOT/runner/package.json" <<'EOF'
{
  "name": "forge-spec-runner",
  "private": true,
  "description": "Forge-managed Playwright workspace for running generated specs. Not for editing — forge-bootstrap.sh maintains this directory.",
  "dependencies": {
    "@playwright/test": "^1.49.0",
    "dotenv": "^16.4.0"
  }
}
EOF

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

# Install runner dependencies. Re-runs `npm install` if ANY declared dep is
# missing — not just @playwright/test — so version bumps and new deps (e.g.
# dotenv added later for ad-hoc spec-run env loading) land on existing
# installs.
NEEDS_INSTALL=0
for dep in @playwright/test dotenv; do
  if [ ! -d "$ROOT/runner/node_modules/$dep" ]; then
    NEEDS_INSTALL=1
    break
  fi
done

if [ "$NEEDS_INSTALL" -eq 1 ]; then
  echo "forge: installing/updating plugin runner deps in $ROOT/runner/ (~30s on first run)…" >&2
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
