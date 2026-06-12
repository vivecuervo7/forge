#!/usr/bin/env bash
# Sandbox helpers for forge evals. The sandbox is /Users/isaac/repos/forge-tests/.
#
# Helpers reset the pool slots to a known free state, scrub residual chromium
# storage, and optionally clear forge/videos/ + forge/test-results/.

set -u

SANDBOX_ROOT="${SANDBOX_ROOT:-/Users/isaac/repos/forge-tests}"
SANDBOX_POOL="$SANDBOX_ROOT/forge/.pool"

PLUGIN_SCRIPTS="${PLUGIN_SCRIPTS:-/Users/isaac/repos/claude-plugins/plugins/forge/scripts}"

sandbox_reset_pool() {
  for state in "$SANDBOX_POOL"/slot-*/state.json; do
    [ -e "$state" ] || continue
    jq '.checkedOutBy = null' "$state" > "$state.tmp" && mv "$state.tmp" "$state"
  done
}

sandbox_scrub_slots() {
  for slot in "$SANDBOX_POOL"/slot-*; do
    [ -d "$slot" ] || continue
    bash "$PLUGIN_SCRIPTS/forge-pool-reset.sh" "$slot" 2>/dev/null || true
  done
}

sandbox_clear_artifacts() {
  rm -rf "$SANDBOX_ROOT/forge/test-results"/* 2>/dev/null
  rm -rf "$SANDBOX_ROOT/forge/videos"/* 2>/dev/null
}

# Full reset: free claims + scrub state + clear artifacts. Use before each case
# that runs the spec runner or attaches a chromium session.
sandbox_full_reset() {
  sandbox_reset_pool
  sandbox_scrub_slots
  sandbox_clear_artifacts
}
