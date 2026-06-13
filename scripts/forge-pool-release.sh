#! /usr/bin/env bash
# forge-pool-release.sh — release a previously-claimed slot back to the pool.
#
# Two jobs:
#   1. Close the slot's live playwright-cli session (if any) so the
#      chromium processes don't leak across runs. The session name is
#      stored in state.json as `playwrightSessionName`; we read it,
#      call `playwright-cli -s=<name> close`, and treat failure as
#      non-fatal — the bookkeeping in step 2 still has to happen even
#      if the session is already gone or the close errors.
#   2. Set state.json's checkedOutBy to null and update lastReleased.
#      Pure bookkeeping under the pool lock.
#
# Cleanup responsibilities not covered here:
#   - Profile-state scrub (cookies, localStorage, sessionStorage on the
#     chromium profile) fires at CLAIM time via forge-pool-reset.sh,
#     invoked by the /forge skill lead during phase 1.5b. Runs while the
#     session is offline (we just closed it above, or it crashed
#     previously) so file deletes don't race with chromium holding
#     SQLite locks.
#   - Project-specific teardown (server-side state, logout endpoints,
#     account resets, etc.) is governed by the `## Teardown after each
#     run` section in forge/hints/forge.md — interpreted by the lead as
#     natural-language instructions during SKILL.md phase 5, before this
#     script is invoked.
#
# Locking: re-execs itself under the platform's lock tool (flock on
# Linux, lockf on macOS) to serialize claim/release operations. The
# session close happens BEFORE the lock acquisition so we don't hold the
# pool lock while a (potentially slow) playwright-cli close runs.
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

# Close the slot's live playwright-cli session (if any) before taking the
# pool lock. Best-effort: a missing session, a non-installed playwright-cli,
# or a close error are all non-fatal — the bookkeeping below still runs so
# the slot is freed for the next claim. The chromium-leak situation we're
# preventing is the live case (driver opened a session, finished its work,
# but never told playwright-cli to close it). A crashed-run remnant gets
# the same treatment: try to close, ignore errors, move on.
SESSION_NAME=$(jq -r '.playwrightSessionName // empty' "$STATE_FILE" 2>/dev/null || true)
if [ -n "$SESSION_NAME" ] && command -v playwright-cli >/dev/null 2>&1; then
  playwright-cli -s="$SESSION_NAME" close >/dev/null 2>&1 || true
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

TMP=$(mktemp)
jq --arg ts "$NOW" \
   '.checkedOutBy = null | .lastReleased = $ts' \
   "$STATE_FILE" > "$TMP" && mv "$TMP" "$STATE_FILE"

echo "forge-pool-release: released $SLOT_DIR"
