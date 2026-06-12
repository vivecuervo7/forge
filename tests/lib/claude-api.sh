#!/usr/bin/env bash
# Minimal Anthropic Messages API wrapper for forge evals.
#
# Usage:
#   source lib/claude-api.sh
#   answer=$(claude_oneshot "system prompt" "user prompt" "model")
#
# Requires ANTHROPIC_API_KEY in env. Uses curl + jq.

set -u

CLAUDE_API_BASE="${CLAUDE_API_BASE:-https://api.anthropic.com}"
CLAUDE_API_VERSION="2023-06-01"

claude_require_key() {
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ANTHROPIC_API_KEY is not set — automated cases require it." >&2
    return 1
  fi
}

# claude_oneshot <system> <user> [model] [max_tokens]
# Returns the assistant's text content on stdout. Non-zero on transport error.
claude_oneshot() {
  local system="$1"
  local user="$2"
  local model="${3:-claude-sonnet-4-5}"
  local max_tokens="${4:-128}"

  claude_require_key || return 1

  local body
  body=$(jq -nc \
    --arg model "$model" \
    --arg system "$system" \
    --arg user "$user" \
    --argjson max_tokens "$max_tokens" \
    '{
      model: $model,
      max_tokens: $max_tokens,
      temperature: 0,
      system: $system,
      messages: [{ role: "user", content: $user }]
    }')

  local response
  response=$(curl -sS \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: $CLAUDE_API_VERSION" \
    -H "content-type: application/json" \
    -d "$body" \
    "$CLAUDE_API_BASE/v1/messages")

  # Error responses have a top-level "error" object.
  if echo "$response" | jq -e '.error' >/dev/null 2>&1; then
    echo "claude_oneshot: API error: $(echo "$response" | jq -c .error)" >&2
    return 2
  fi

  echo "$response" | jq -r '.content[0].text'
}
