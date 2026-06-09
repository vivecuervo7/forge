#!/usr/bin/env bash
# SessionEnd hook — best-effort cleanup of this Claude session's forge state.
#
# Fires on graceful exit (clear, resume, logout). Does NOT fire on crashes,
# SIGKILL, or forceful terminal close — those leftovers are caught by the
# orphan-detector scan that the forge skill runs on next invocation.
#
# Silent on success. Never blocks the session: always exits 0.

set -u

# No session id → nothing to clean up. (Shouldn't happen under Claude Code,
# but defensive.)
[ -z "${CLAUDE_CODE_SESSION_ID:-}" ] && exit 0

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=$(bash "$SCRIPT_DIR/../scripts/forge-root.sh" 2>/dev/null)
[ -z "$ROOT" ] && exit 0

SHORT_ID="${CLAUDE_CODE_SESSION_ID:0:8}"

# Close the playwright-cli daemon (managed and attach variants — only one will
# exist for any given session, but try both since we don't know which mode was
# in use). Silent failure is fine: the daemon may have never been launched, or
# may already be gone.
if command -v playwright-cli >/dev/null 2>&1; then
  playwright-cli -s="forge-$SHORT_ID"        close >/dev/null 2>&1 || true
  playwright-cli -s="forge-attach-$SHORT_ID" close >/dev/null 2>&1 || true
fi

# Remove this session's run dir. The transcript lives in $ROOT/sessions/ and is
# NOT removed — it's the durable record of what was driven this session.
RUN_DIR="$ROOT/runs/$CLAUDE_CODE_SESSION_ID"
[ -d "$RUN_DIR" ] && rm -rf "$RUN_DIR"

exit 0
