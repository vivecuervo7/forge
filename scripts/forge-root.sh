#!/usr/bin/env bash
# Resolves the forge data root.
# Order: $FORGE_ROOT → ~/.claude/.vive-claude/forge
set -uo pipefail

echo "${FORGE_ROOT:-$HOME/.claude/.vive-claude/forge}"
