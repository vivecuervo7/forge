#!/usr/bin/env bash
# forge-pool-release.sh — release a previously-claimed slot back to the pool.
#
# Sets state.json's checkedOutBy to null and updates lastReleased. That's
# the entire job: pure bookkeeping under the pool lock.
#
# Cleanup responsibilities are split elsewhere:
#   - Client-side scrub (cookies, localStorage, sessionStorage on the
#     chromium profile) fires at CLAIM time via forge-pool-reset.sh,
#     invoked by the /forge skill lead during phase 1.5b — not by this
#     script. Reliable across crashed runs and "I know better" persona
#     overrides; no live session to coordinate with.
#   - Project-specific teardown (server-side state, logout endpoints,
#     account resets, etc.) is governed by the `## Teardown after each
#     run` section in forge/hints/forge.md — interpreted by the lead as
#     natural-language instructions during SKILL.md phase 5, before this
#     script is invoked.
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

# Cleanup happens elsewhere — see the header comment for the split.

TMP=$(mktemp)
jq --arg ts "$NOW" \
   '.checkedOutBy = null | .lastReleased = $ts' \
   "$STATE_FILE" > "$TMP" && mv "$TMP" "$STATE_FILE"

echo "forge-pool-release: released $SLOT_DIR"
