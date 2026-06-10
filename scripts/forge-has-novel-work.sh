#!/usr/bin/env bash
# forge-has-novel-work.sh — inspect the current session's transcript and
# report whether the driver did novel browser work (drove events), only
# reused existing library snippets (invoked events), or never landed any
# events at all.
#
# Always exits 0 on normal completion. Output to stdout is a single token:
#
#   novel          — the transcript contains at least one `drove` event
#   reuse-only     — transcript exists with `invoked`/`note` events only,
#                    no `drove` events. The driver reused snippets exclusively.
#   no-transcript  — the transcript file is missing or empty. The driver
#                    either never ran or its registry calls didn't write
#                    (env propagation failure, registry crash, etc.). The
#                    orchestrator should treat this as a hard error — there
#                    is nothing for the downstream agents to read.
#
# Exit 2 (with diagnostic on stderr) only when CLAUDE_CODE_SESSION_ID is
# unset — that's a genuine environment problem, not a normal outcome.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  echo "forge-has-novel-work: CLAUDE_CODE_SESSION_ID not set" >&2
  exit 2
fi

ROOT=$(bash "$SCRIPT_DIR/forge-root.sh")
TRANSCRIPT="${ROOT}/sessions/${CLAUDE_CODE_SESSION_ID}.jsonl"

if [ ! -s "$TRANSCRIPT" ]; then
  # Missing file OR present-but-empty. Either way: the driver didn't manage to
  # land any events. Distinct from reuse-only — downstream agents have nothing
  # to read and should refuse.
  echo "no-transcript"
elif grep -q '"event":"drove"' "$TRANSCRIPT"; then
  echo "novel"
else
  echo "reuse-only"
fi
