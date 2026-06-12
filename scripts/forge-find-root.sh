#!/usr/bin/env bash
# forge-find-root.sh — locate the project's forge/ directory.
#
# Walks up from a starting directory (default: PWD) looking for a forge/hints/
# directory. The first match wins — same pattern as git looking for .git/, npm
# looking for node_modules/. Prints the absolute path to forge/ to stdout.
#
# Exits non-zero with a helpful error if no forge root is found before reaching
# the filesystem root, so callers can surface "you're not in a forge project"
# to the user.
#
# Usage:
#   forge-find-root.sh                  # from PWD
#   forge-find-root.sh <starting-dir>   # from a specific dir

set -euo pipefail

START="${1:-$PWD}"

if [ ! -d "$START" ]; then
  echo "forge-find-root: starting directory does not exist: $START" >&2
  exit 2
fi

# Resolve to absolute path so the walk is unambiguous
DIR=$(cd "$START" && pwd)

while [ "$DIR" != "/" ]; do
  if [ -d "$DIR/forge/hints" ]; then
    echo "$DIR/forge"
    exit 0
  fi
  DIR=$(dirname "$DIR")
done

# Check the root itself
if [ -d "/forge/hints" ]; then
  echo "/forge"
  exit 0
fi

echo "forge-find-root: no forge/ directory found in $START or any parent." >&2
echo "  Run /forge init in the project root to scaffold one." >&2
exit 1
