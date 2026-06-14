#!/usr/bin/env node
// forge-pool-reset.mjs — scrub the default web-storage primitives from a
// pool slot's chromium profile.
//
// Mechanical, filesystem-level. Knows nothing about hints. Pure function of
// a slot directory: deletes the on-disk artifacts that hold cookies,
// localStorage, and sessionStorage under the slot's chromium profile.
// Anything else (IndexedDB, Service Workers, server-side state, account
// resets, etc.) is the lead's responsibility via hint interpretation.
//
// Runs at claim time, not release time — by design. The slot's chromium
// session is not live at claim, so we can delete files directly without
// worrying about SQLite locks or current-page-origin scoping. Idempotent
// and safe to call on a brand-new slot whose profile dir doesn't exist yet.
//
// Usage:
//   forge-pool-reset.mjs <slot-dir>

import { rmSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const slotDir = process.argv[2]

if (!slotDir) {
  console.error('Usage: forge-pool-reset.mjs <slot-dir>')
  process.exit(2)
}

if (!existsSync(slotDir) || !statSync(slotDir).isDirectory()) {
  console.error(`forge-pool-reset: slot dir does not exist: ${slotDir}`)
  process.exit(3)
}

const profileDefault = join(slotDir, 'profile', 'Default')

// Brand-new slot: no profile yet. Nothing to scrub.
if (!existsSync(profileDefault)) {
  process.exit(0)
}

// Default scrub: cookies + localStorage + sessionStorage. The primitives that
// have bitten us empirically (cart-state leak) and that every login flow
// touches. Anything beyond this is project-specific — the lead handles it
// via hint instructions.
const targets = [
  'Cookies',           // sqlite file
  'Cookies-journal',   // sqlite journal (may not exist)
  'Local Storage',     // leveldb directory
  'Session Storage',   // leveldb directory
]

for (const name of targets) {
  const target = join(profileDefault, name)
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
}
