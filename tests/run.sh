#!/usr/bin/env bash
# forge eval suite runner.
#
# Usage:
#   ./run.sh                  # run all cases
#   ./run.sh <case-name>      # run a single case
#
# Automated cases live in cases/<name>.sh; runbook cases in cases/<name>.md.
# Runbook cases print a one-liner pointing at their .md file and exit 77 (skip).

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# All cases. Automated cases first (most expensive to run, fastest signal);
# runbook cases listed afterwards as reminders.
AUTOMATED=(
  "mode-detection"
)

RUNBOOK=(
  "drive-with-library"
  "spec-end-to-end"
)

run_automated() {
  local name="$1"
  local script="cases/$name.sh"
  if [ ! -x "$script" ]; then
    echo "[$name] script not found or not executable: $script" >&2
    return 1
  fi

  echo "============================================================"
  echo " $name (automated)"
  echo "============================================================"
  if "$script"; then
    return 0
  else
    local rc=$?
    if [ "$rc" -eq 77 ]; then
      return 77
    fi
    return 1
  fi
}

run_runbook() {
  local name="$1"
  local doc="cases/$name.md"
  echo "============================================================"
  echo " $name (runbook — manual)"
  echo "============================================================"
  echo "  See: $doc"
  echo "  Follow the runbook to exercise this case against the sandbox."
  return 77
}

# Single-case mode
if [ $# -gt 0 ]; then
  CASE="$1"
  for c in "${AUTOMATED[@]}"; do
    if [ "$c" = "$CASE" ]; then
      run_automated "$c"
      exit $?
    fi
  done
  for c in "${RUNBOOK[@]}"; do
    if [ "$c" = "$CASE" ]; then
      run_runbook "$c"
      exit $?
    fi
  done
  echo "Unknown case: $CASE" >&2
  echo "Available:" >&2
  printf '  %s\n' "${AUTOMATED[@]}" "${RUNBOOK[@]}" >&2
  exit 2
fi

# Run-all mode
declare -i PASSED=0
declare -i FAILED=0
declare -i SKIPPED=0
FAILED_NAMES=()

for c in "${AUTOMATED[@]}"; do
  run_automated "$c"
  rc=$?
  case "$rc" in
    0)  PASSED=$((PASSED + 1)) ;;
    77) SKIPPED=$((SKIPPED + 1)) ;;
    *)  FAILED=$((FAILED + 1)); FAILED_NAMES+=("$c") ;;
  esac
done

for c in "${RUNBOOK[@]}"; do
  run_runbook "$c"
  SKIPPED=$((SKIPPED + 1))
done

echo ""
echo "============================================================"
echo " Summary"
echo "============================================================"
echo "  passed:  $PASSED"
echo "  failed:  $FAILED"
echo "  skipped: $SKIPPED (includes runbook cases)"

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "Failed cases:"
  printf '  - %s\n' "${FAILED_NAMES[@]}"
  exit 1
fi
exit 0
