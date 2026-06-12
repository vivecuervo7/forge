#!/usr/bin/env bash
# mode-detection — test that /forge's phase 0 picks the correct mode across a
# matrix of input phrasings. Calls the Anthropic API with the SKILL.md phase 0
# section as system context and each test input as user content; asserts the
# returned word matches expected.
#
# Why this matters: phase 0 is the routing brain. If it misfires, the whole
# downstream flow gets the wrong team composition. This is the cheapest case
# to test in isolation and the most regression-prone.

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
TESTS_ROOT="$(dirname "$HERE")"
SKILL_MD="$TESTS_ROOT/../skills/forge/SKILL.md"

source "$TESTS_ROOT/lib/claude-api.sh"

# Extract Phase 0 from SKILL.md so the test follows the live rule. We grab
# everything between "## Phase 0" and the next top-level "## " heading.
extract_phase_0() {
  awk '
    /^## Phase 0/ { capture=1; print; next }
    /^## / && capture { exit }
    capture { print }
  ' "$SKILL_MD"
}

PHASE_0=$(extract_phase_0)
if [ -z "$PHASE_0" ]; then
  echo "mode-detection: failed to extract Phase 0 from $SKILL_MD" >&2
  exit 3
fi

SYSTEM_PROMPT=$(cat <<EOF
You are testing the mode-detection logic of the /forge skill.

Below is the relevant section of SKILL.md that defines the rules. Apply these
rules to the user's input and respond with exactly one word on a single line:
either "drive" or "spec". No punctuation, no other text.

---

$PHASE_0
EOF
)

# Test matrix — (input, expected_mode, notes).
# Add cases here as edge cases surface in real runs.
CASES=(
  "add backpack to cart|drive|baseline drive"
  "spec add backpack to cart|spec|explicit spec keyword (first word)"
  "create a spec for adding the backpack|spec|natural-language create-a-spec"
  "write a spec that adds the backpack|spec|natural-language write-a-spec"
  "spec for AE-1775|spec|natural-language spec-for-X"
  "the spec is already correct, just drive me through it|drive|incidental spec mention, not a request to create one"
  "label it spec-investigation and run|drive|spec-as-label-substring, not an authoring intent"
  "delete every email from noreply@vendor.com|drive|long task with no spec mention"
)

PASS=0
FAIL=0
FAIL_DETAILS=()

claude_require_key || {
  echo "mode-detection: SKIPPED (no ANTHROPIC_API_KEY)" >&2
  echo "  Set ANTHROPIC_API_KEY in env to run this case." >&2
  exit 77  # POSIX convention for skipped
}

echo "mode-detection: running ${#CASES[@]} case(s)…"
echo ""

for spec in "${CASES[@]}"; do
  IFS='|' read -r input expected notes <<< "$spec"

  USER_PROMPT=$(cat <<EOF
The user invoked /forge with this argument:

$input

Apply the rules above. Output one word only: drive or spec.
EOF
)

  result=$(claude_oneshot "$SYSTEM_PROMPT" "$USER_PROMPT" "claude-sonnet-4-5" 8 2>/dev/null || echo "ERROR")
  # Normalize: strip whitespace, lowercase.
  result_normalized=$(echo "$result" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')

  if [ "$result_normalized" = "$expected" ]; then
    printf "  \033[32mPASS\033[0m  %-60s → %s\n" "$input" "$expected"
    PASS=$((PASS + 1))
  else
    printf "  \033[31mFAIL\033[0m  %-60s → expected %s, got %s\n" "$input" "$expected" "$result_normalized"
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("  input:    $input")
    FAIL_DETAILS+=("  expected: $expected")
    FAIL_DETAILS+=("  got:      $result_normalized")
    FAIL_DETAILS+=("  notes:    $notes")
    FAIL_DETAILS+=("")
  fi
done

echo ""
echo "mode-detection: $PASS passed, $FAIL failed (of ${#CASES[@]} total)"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed case details:"
  for line in "${FAIL_DETAILS[@]}"; do
    echo "$line"
  done
  exit 1
fi

exit 0
