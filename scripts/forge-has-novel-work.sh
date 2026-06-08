#!/usr/bin/env bash
# forge-has-novel-work.sh — does the current session's transcript contain
# any `drove` events (i.e. did the driver do novel browser work, beyond
# invoking existing library snippets)?
#
# Exit 0: yes, novel work was recorded
# Exit 1: no novel work (transcript missing, empty, or only contains
#         `invoked`/`note` events)
# Exit 2: CLAUDE_CODE_SESSION_ID not set; can't determine
#
# The skill uses this to decide whether to invoke the forge:author agent.

set -uo pipefail

if [ -z "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  echo "forge-has-novel-work: CLAUDE_CODE_SESSION_ID not set" >&2
  exit 2
fi

TRANSCRIPT="${HOME}/.claude/.vive-claude/forge/sessions/${CLAUDE_CODE_SESSION_ID}.jsonl"

if [ ! -f "$TRANSCRIPT" ]; then
  exit 1
fi

grep -q '"event":"drove"' "$TRANSCRIPT"
