#!/usr/bin/env bash
# forge-has-novel-work.sh — inspect the current session's transcript and
# report whether the driver did novel browser work (drove events) or only
# reused existing library snippets (invoked events).
#
# Always exits 0 on normal completion. Output to stdout is a single token:
#
#   novel       — the transcript contains at least one `drove` event
#   reuse-only  — no `drove` events; every step used an existing snippet
#                 (or the transcript is missing/empty)
#
# Exit 2 (with diagnostic on stderr) only when CLAUDE_CODE_SESSION_ID is
# unset — that's a genuine environment problem, not a normal outcome.

set -uo pipefail

if [ -z "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  echo "forge-has-novel-work: CLAUDE_CODE_SESSION_ID not set" >&2
  exit 2
fi

TRANSCRIPT="${HOME}/.claude/.vive-claude/forge/sessions/${CLAUDE_CODE_SESSION_ID}.jsonl"

if [ -f "$TRANSCRIPT" ] && grep -q '"event":"drove"' "$TRANSCRIPT"; then
  echo "novel"
else
  echo "reuse-only"
fi
