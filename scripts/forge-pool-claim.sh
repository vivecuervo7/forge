#!/usr/bin/env bash
# forge-pool-claim.sh — atomically claim an available slot from a forge pool.
#
# Scans slot directories under the pool, finds the first one whose
# state.json has `checkedOutBy: null`, marks it checked out (with the
# claimant ID + ISO timestamp), and prints the absolute slot path to
# stdout.
#
# If no slot is available, prints EXHAUSTED to stderr and exits non-zero —
# the caller is expected to follow the project's provisioning recipe
# (from forge/hints/forge.md) to mint a new slot, then re-attempt the claim.
#
# Slot state.json schema (minimum):
#   {
#     "checkedOutBy": null | "<id>@<iso-timestamp>",
#     "lastClaimed":  "<iso-timestamp>",
#     "lastReleased": "<iso-timestamp>"
#   }
#
# Each slot directory must contain its own state.json. Slot dirs are
# scanned alphabetically; the first available slot wins (deterministic).
#
# Locking: re-execs itself under the platform's lock tool (flock on
# Linux, lockf on macOS) to serialize claim/release operations.
#
# Usage:
#   forge-pool-claim.sh <pool-dir> [claimant-id]
#
# Claimant ID defaults to ${CLAUDE_CODE_SESSION_ID:-pid-$$}.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: forge-pool-claim.sh <pool-dir> [claimant-id]" >&2
  exit 2
fi

POOL_DIR="$1"
CLAIMANT="${2:-${CLAUDE_CODE_SESSION_ID:-pid-$$}}"

if [ ! -d "$POOL_DIR" ]; then
  echo "forge-pool-claim: pool dir does not exist: $POOL_DIR" >&2
  exit 3
fi

LOCK_FILE="$POOL_DIR/.lock"
if [ ! -e "$LOCK_FILE" ]; then
  echo "forge-pool-claim: pool not initialized (no .lock file at $LOCK_FILE)." >&2
  echo "  Run forge-pool-init.sh first." >&2
  exit 3
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "forge-pool-claim: jq is required but not installed." >&2
  exit 4
fi

# Re-exec under a platform lock tool if we're not already under one.
# The FORGE_POOL_LOCKED guard prevents infinite recursion.
if [ -z "${FORGE_POOL_LOCKED:-}" ]; then
  if command -v flock >/dev/null 2>&1; then
    FORGE_POOL_LOCKED=1 exec flock -x "$LOCK_FILE" "$0" "$@"
  elif command -v lockf >/dev/null 2>&1; then
    # macOS BSD lockf deletes the lock file by default; -k preserves it
    # and (per the manpage) gives lock-ordering guarantees + better perf.
    FORGE_POOL_LOCKED=1 exec lockf -k "$LOCK_FILE" "$0" "$@"
  else
    echo "forge-pool-claim: neither flock nor lockf available — cannot serialize claims." >&2
    exit 4
  fi
fi

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TIMESTAMPED_CLAIM="${CLAIMANT}@${NOW}"

# Resolve to absolute path so the slot path we print is unambiguous.
POOL_DIR_ABS=$(cd "$POOL_DIR" && pwd)

# Scan slot directories. Layout: <pool>/slot-*/state.json
CLAIMED=""
while IFS= read -r STATE_FILE; do
  [ -z "$STATE_FILE" ] && continue
  [ ! -f "$STATE_FILE" ] && continue

  # Parse checkedOutBy; tolerate malformed json by skipping
  CHECKED_OUT_BY=$(jq -r '.checkedOutBy // empty' "$STATE_FILE" 2>/dev/null) || continue

  if [ -z "$CHECKED_OUT_BY" ]; then
    SLOT_DIR=$(dirname "$STATE_FILE")
    SLOT_DIR_ABS=$(cd "$SLOT_DIR" && pwd)

    TMP=$(mktemp)
    jq --arg by "$TIMESTAMPED_CLAIM" --arg ts "$NOW" \
       '.checkedOutBy = $by | .lastClaimed = $ts' \
       "$STATE_FILE" > "$TMP" && mv "$TMP" "$STATE_FILE"

    CLAIMED="$SLOT_DIR_ABS"
    break
  fi
done < <(find "$POOL_DIR_ABS" -mindepth 2 -maxdepth 2 -name state.json -type f 2>/dev/null | sort)

if [ -z "$CLAIMED" ]; then
  echo "EXHAUSTED" >&2
  exit 1
fi

echo "$CLAIMED"
