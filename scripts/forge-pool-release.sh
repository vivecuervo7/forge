#!/usr/bin/env bash
# forge-pool-release.sh — release a previously-claimed slot back to the pool.
#
# Sets state.json's checkedOutBy to null and updates lastReleased. If the
# slot contains an executable release.sh hook, it's invoked with the slot
# dir as its single argument BEFORE the checkout is cleared — giving
# projects a chance to do their own cleanup (logout calls, state reset,
# etc.) while still holding the lock.
#
# If the release hook exits non-zero, the slot is NOT released — caller
# should treat as a release failure.
#
# Default cleanup expected by most projects (cookie + localStorage wipe on
# the chromium profile) lives elsewhere; this script only handles the
# checkout-state side and the optional hook.
#
# Locking: re-execs itself under the platform's lock tool (flock on
# Linux, lockf on macOS) to serialize claim/release operations.
#
# Usage:
#   forge-pool-release.sh <pool-dir> <slot-dir>

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: forge-pool-release.sh <pool-dir> <slot-dir>" >&2
  exit 2
fi

POOL_DIR="$1"
SLOT_DIR="$2"

if [ ! -d "$POOL_DIR" ]; then
  echo "forge-pool-release: pool dir does not exist: $POOL_DIR" >&2
  exit 3
fi

if [ ! -d "$SLOT_DIR" ]; then
  echo "forge-pool-release: slot dir does not exist: $SLOT_DIR" >&2
  exit 3
fi

STATE_FILE="$SLOT_DIR/state.json"
if [ ! -f "$STATE_FILE" ]; then
  echo "forge-pool-release: state.json missing in slot: $SLOT_DIR" >&2
  exit 3
fi

LOCK_FILE="$POOL_DIR/.lock"
if [ ! -e "$LOCK_FILE" ]; then
  echo "forge-pool-release: pool not initialized (no .lock file at $LOCK_FILE)." >&2
  exit 3
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "forge-pool-release: jq is required but not installed." >&2
  exit 4
fi

# Re-exec under a platform lock tool if not already locked.
if [ -z "${FORGE_POOL_LOCKED:-}" ]; then
  if command -v flock >/dev/null 2>&1; then
    FORGE_POOL_LOCKED=1 exec flock -x "$LOCK_FILE" "$0" "$@"
  elif command -v lockf >/dev/null 2>&1; then
    # macOS BSD lockf deletes the lock file by default; -k preserves it
    # and (per the manpage) gives lock-ordering guarantees + better perf.
    FORGE_POOL_LOCKED=1 exec lockf -k "$LOCK_FILE" "$0" "$@"
  else
    echo "forge-pool-release: neither flock nor lockf available — cannot serialize." >&2
    exit 4
  fi
fi

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Run project release hook (if present and executable) before clearing
# the checkout. The hook gets the slot dir as its single argument.
RELEASE_HOOK="$SLOT_DIR/release.sh"
if [ -x "$RELEASE_HOOK" ]; then
  if ! "$RELEASE_HOOK" "$SLOT_DIR"; then
    echo "forge-pool-release: release hook exited non-zero for $SLOT_DIR" >&2
    echo "  Slot is NOT being released. Investigate and re-run." >&2
    exit 5
  fi
fi

TMP=$(mktemp)
jq --arg ts "$NOW" \
   '.checkedOutBy = null | .lastReleased = $ts' \
   "$STATE_FILE" > "$TMP" && mv "$TMP" "$STATE_FILE"

echo "forge-pool-release: released $SLOT_DIR"
