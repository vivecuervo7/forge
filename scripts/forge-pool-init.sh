#!/usr/bin/env bash
# forge-pool-init.sh — initialize a forge pool directory.
#
# Creates the pool root with restrictive permissions (chmod 700, user-only)
# and the .lock file used by claim/release for serialization. Idempotent.
#
# A pool dir is typically located at <project>/forge/.pool/ but the location
# is up to the project's hints — this script accepts whatever path it's given.
#
# Slots inside the pool are not created here; they're minted on-demand by
# the provisioning recipe in each project's forge.md hint.
#
# Usage:
#   forge-pool-init.sh <pool-dir>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: forge-pool-init.sh <pool-dir>" >&2
  exit 2
fi

POOL_DIR="$1"

mkdir -p "$POOL_DIR"
chmod 700 "$POOL_DIR"

# Lock file used by claim/release for serialization
LOCK_FILE="$POOL_DIR/.lock"
if [ ! -e "$LOCK_FILE" ]; then
  : > "$LOCK_FILE"
fi

echo "forge-pool-init: initialized $POOL_DIR"
