#!/usr/bin/env bash
# forge-init.sh — scaffold the forge/ project convention into the current directory.
#
# Creates forge/ with the canonical layout: a gitignored data root, a hints/
# directory for project-specific knowledge, a fallback Playwright config, and
# a forge-level .env. Template content lives at plugins/forge/templates/init/
# and is copied verbatim into the target on missing files.
#
# Idempotent: existing files are preserved. Re-running fills in anything
# missing without overwriting customizations.
#
# Usage:
#   forge-init.sh [target-dir]
#
# Defaults to PWD when no arg given.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
TEMPLATES="$PLUGIN_ROOT/templates/init"

if [ ! -d "$TEMPLATES" ]; then
  echo "forge-init: missing templates directory at $TEMPLATES" >&2
  exit 2
fi

TARGET_DIR="${1:-$PWD}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "forge-init: target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

FORGE_DIR="$TARGET_DIR/forge"
HINTS_DIR="$FORGE_DIR/hints"

mkdir -p "$FORGE_DIR" "$HINTS_DIR"

CREATED=()
SKIPPED=()

# scaffold <template-name> <dest-relative-to-forge-dir>
scaffold() {
  local template="$1"
  local dest_rel="$2"
  local src="$TEMPLATES/$template"
  local dest="$FORGE_DIR/$dest_rel"

  if [ ! -f "$src" ]; then
    echo "forge-init: template missing: $src" >&2
    exit 2
  fi

  if [ -e "$dest" ]; then
    SKIPPED+=("forge/$dest_rel")
  else
    cp "$src" "$dest"
    CREATED+=("forge/$dest_rel")
  fi
}

# Templates use dot-less names so they're visible in the templates dir;
# scaffold them under their dotted destination names where appropriate.
scaffold gitignore             .gitignore
scaffold README.md             README.md
scaffold hints-README.md       hints/README.md
scaffold playwright.config.ts  playwright.config.ts
scaffold env                   .env

# Report
echo "forge-init: scaffolded $FORGE_DIR"
if [ ${#CREATED[@]} -gt 0 ]; then
  echo "  Created:"
  for f in "${CREATED[@]}"; do
    echo "    + $f"
  done
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "  Preserved (already present):"
  for f in "${SKIPPED[@]}"; do
    echo "    = $f"
  done
fi

# Ensure a Playwright runner is ready for spec runs. If the project has its
# own playwright.config + @playwright/test, this is a no-op; otherwise it
# installs the plugin-shipped runner so the first spec verification doesn't
# pay the ~30s install cost mid-run. Non-fatal if it fails — the user can
# still author hints and drive in drive-mode; the install will retry the
# first time --spec actually needs it.
if command -v node >/dev/null 2>&1; then
  if ! node "$SCRIPT_DIR/forge-ensure-runner.mjs" "$FORGE_DIR" 2>&1; then
    echo "forge-init: runner pre-install failed (non-fatal — will retry on first --spec use)."
  fi
else
  echo "forge-init: node not available; skipping runner pre-install."
  echo "  (If you intend to run specs, install node so the runner can be bootstrapped.)"
fi

echo ""
echo "Next: author hint files in $HINTS_DIR/ to describe your project's"
echo "env contract, provisioning recipe, and any project-specific conventions."
echo "See $HINTS_DIR/README.md for guidance."
