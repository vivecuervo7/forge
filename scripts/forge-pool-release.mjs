#!/usr/bin/env node
// forge-pool-release.mjs — release a previously-claimed slot back to the pool.
//
// Two jobs, done in order:
//   1. Close the slot's live playwright-cli session (if any). Read
//      sessionName from state.json; invoke `playwright-cli close`. If close
//      fails or the chromium process survives, fall back to tree-kill on the
//      session's PID family. Best-effort but aggressive — leaving chromium
//      processes lying around is the main complaint forge gets.
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
// Locking: serialized via proper-lockfile against the pool dir.
//
// Usage:
//   forge-pool-release.mjs <pool-dir> <slot-dir>

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureRunnerDeps, loadFromRunner } from './forge-ensure-runner.mjs'

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

const forgeRoot = dirname(poolDir)
ensureRunnerDeps(forgeRoot)

const { execa } = await loadFromRunner(forgeRoot, 'execa')
const lockfile = await loadFromRunner(forgeRoot, 'proper-lockfile')
const writeFileAtomic = (await loadFromRunner(forgeRoot, 'write-file-atomic')).default
const treeKill = (await loadFromRunner(forgeRoot, 'tree-kill')).default
const findProcess = (await loadFromRunner(forgeRoot, 'find-process')).default

// Step 1: best-effort close of the live playwright-cli session. Done outside
// the pool lock so a slow close doesn't serialize other claims.
try {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  const sessionName = state.playwrightSessionName

  if (sessionName) {
    // Try graceful close first.
    try {
      await execa('playwright-cli', [`-s=${sessionName}`, 'close'], { reject: false, timeout: 10_000 })
    } catch {
      // Non-fatal — fall through to force-kill.
    }

    // If a chromium process for this session is still alive, force-kill its
    // tree. find-process gives us PIDs by command-line match. Heuristic:
    // chromium spawned by playwright-cli typically includes the user-data-dir
    // path which contains the slot path. Match on the slot path.
    try {
      const procs = await findProcess('name', 'chrom', true)  // matches chromium / chrome
      const orphans = procs.filter(p => (p.cmd || '').includes(slotDir))
      for (const p of orphans) {
        await new Promise(r => treeKill(p.pid, 'SIGKILL', () => r()))
      }
    } catch {
      // Non-fatal — chromium kill best-effort.
    }
  }
} catch {
  // Malformed state.json — proceed; the lock+bookkeeping step still runs.
}

const release = await lockfile.lock(poolDir, {
  retries: { retries: 20, minTimeout: 50, maxTimeout: 200 },
  stale: 30_000,
  realpath: false,
})

try {
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

  await writeFileAtomic(stateFile, JSON.stringify(state, null, 2) + '\n')
} finally {
  await release()
}

console.log(`forge-pool-release: released ${slotDir}`)
