#!/usr/bin/env node
// forge-pool-release.mjs — release a previously-claimed slot back to the pool.
//
// Two jobs:
//   1. Close the slot's live playwright-cli session (if any). The session
//      name is in state.json as `playwrightSessionName`; we read it, invoke
//      `playwright-cli -s=<name> close`, and treat any failure as non-fatal —
//      bookkeeping in step 2 still happens. Done BEFORE the pool lock so a
//      slow close doesn't serialize other claims.
//   2. Set state.json's checkedOutBy to null and update lastReleased. Pure
//      bookkeeping under the pool lock.
//
// Cleanup not covered here:
//   - Profile-state scrub (cookies / localStorage / sessionStorage) fires at
//     CLAIM time via forge-pool-reset.mjs — runs while the session is offline
//     so file deletes don't race with chromium SQLite locks.
//   - Project-specific teardown (server-side state, logout endpoints, account
//     resets) is governed by the `## Teardown after each run` section in
//     forge/hints/forge.md — interpreted by the lead.
//
// Locking: serialized via mkdir-based mutex at <pool-dir>/.lock/. See
// forge-lock.mjs.
//
// Usage:
//   forge-pool-release.mjs <pool-dir> <slot-dir>

import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { withLock } from './forge-lock.mjs'

const poolArg = process.argv[2]
const slotArg = process.argv[3]

if (!poolArg || !slotArg) {
  console.error('Usage: forge-pool-release.mjs <pool-dir> <slot-dir>')
  process.exit(2)
}

const poolDir = resolve(poolArg)
const slotDir = resolve(slotArg)

if (!existsSync(poolDir) || !statSync(poolDir).isDirectory()) {
  console.error(`forge-pool-release: pool dir does not exist: ${poolDir}`)
  process.exit(3)
}
if (!existsSync(slotDir) || !statSync(slotDir).isDirectory()) {
  console.error(`forge-pool-release: slot dir does not exist: ${slotDir}`)
  process.exit(3)
}

const stateFile = join(slotDir, 'state.json')
if (!existsSync(stateFile)) {
  console.error(`forge-pool-release: state.json missing in slot: ${slotDir}`)
  process.exit(3)
}

// Step 1: best-effort close of the live playwright-cli session. Done outside
// the pool lock so a slow close doesn't block other claims.
try {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  const sessionName = state.playwrightSessionName
  if (sessionName) {
    // Non-fatal: missing playwright-cli, dead session, etc. all OK.
    spawnSync('playwright-cli', [`-s=${sessionName}`, 'close'], {
      stdio: 'ignore',
      shell: false,
    })
  }
} catch {
  // Malformed state.json — proceed; the lock+bookkeeping step still runs.
}

const lockDir = join(poolDir, '.lock')

await withLock(lockDir, () => {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  let state
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch (e) {
    console.error(`forge-pool-release: failed to read state.json: ${e.message}`)
    process.exit(3)
  }

  state.checkedOutBy = null
  state.lastReleased = now

  const tmp = stateFile + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
  renameSync(tmp, stateFile)
})

console.log(`forge-pool-release: released ${slotDir}`)
