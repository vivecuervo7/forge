#!/usr/bin/env bash
# forge-pool-reset.sh — scrub the default web-storage primitives from a
# pool slot's chromium profile.
#
# Mechanical, filesystem-level. Knows nothing about hints. Pure function
# of a slot directory: deletes the on-disk artifacts that hold cookies,
# localStorage, and sessionStorage under the slot's chromium profile.
# Anything else (IndexedDB, Service Workers, server-side state, account
# resets, etc.) is the lead's responsibility to handle by interpreting
# the project's hints during the claim phase.
#
# Runs at claim time, not release time — by design. The slot's chromium
# session is not live at claim, so we can delete files directly without
# worrying about SQLite locks, current-page-origin scoping, or whether
# the previous run terminated cleanly. Idempotent and safe to call on a
# brand-new slot whose profile dir doesn't exist yet.
#
# Usage:
#   forge-pool-reset.sh <slot-dir>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: forge-pool-reset.sh <slot-dir>" >&2
  exit 2
fi

SLOT_DIR="$1"

if [ ! -d "$SLOT_DIR" ]; then
  echo "forge-pool-reset: slot dir does not exist: $SLOT_DIR" >&2
  exit 3
fi

PROFILE_DEFAULT="$SLOT_DIR/profile/Default"

# Brand-new slot: no profile yet. Nothing to scrub; success.
if [ ! -d "$PROFILE_DEFAULT" ]; then
  exit 0
fi

# Default scrub: cookies + localStorage + sessionStorage. These are the
# primitives that have bitten us empirically (cart state leak) and that
# every login flow touches. Anything beyond this is project-specific —
# the lead handles it via hint instructions.
TARGETS=(
  "Cookies"                   # sqlite file
  "Cookies-journal"           # sqlite journal (may not exist)
  "Local Storage"             # leveldb directory
  "Session Storage"           # leveldb directory
)

for name in "${TARGETS[@]}"; do
  path="$PROFILE_DEFAULT/$name"
  if [ -e "$path" ]; then
    rm -rf "$path"
  fi
done
