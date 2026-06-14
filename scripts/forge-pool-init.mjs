#!/usr/bin/env node
// forge-pool-init.mjs — initialize a forge pool directory.
//
// Creates the pool root if missing, with restrictive permissions (user-only
// on POSIX; Windows ignores the mode). Idempotent.
//
// A pool dir is typically located at <project>/forge/.pool/ but the location
// is up to the project's hints — this script accepts whatever path it's given.
//
// Slots inside the pool are not created here; they're minted on-demand by
// the provisioning recipe in each project's forge.md hint.
//
// Usage:
//   forge-pool-init.mjs <pool-dir>

import { mkdirSync, chmodSync } from 'node:fs'

const poolDir = process.argv[2]

if (!poolDir) {
  console.error('Usage: forge-pool-init.mjs <pool-dir>')
  process.exit(2)
}

mkdirSync(poolDir, { recursive: true })

// Best-effort restrict on POSIX; no-op on Windows.
try {
  chmodSync(poolDir, 0o700)
} catch {
  // Windows or non-POSIX FS — ignore.
}

console.log(`forge-pool-init: initialized ${poolDir}`)
