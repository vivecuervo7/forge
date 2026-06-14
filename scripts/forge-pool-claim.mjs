#!/usr/bin/env node
// forge-pool-claim.mjs — atomically claim an available slot from a forge pool.
//
// Scans slot directories under the pool, finds the first one whose state.json
// has `checkedOutBy: null`, marks it checked out (with the claimant ID + ISO
// timestamp), computes-or-retrieves its playwright-cli session name, and
// prints both to stdout as key:value lines so the caller can read each.
//
// If no slot is available, prints EXHAUSTED to stderr and exits non-zero —
// the caller follows the project's provisioning recipe (forge.md) to mint a
// new slot, then re-attempts the claim.
//
// Slot state.json schema (minimum):
//   {
//     "checkedOutBy": null | "<id>@<iso-timestamp>",
//     "lastClaimed":  "<iso-timestamp>",
//     "lastReleased": "<iso-timestamp>",
//     "playwrightSessionName": "ft-<hex>"  // optional; computed on first claim
//   }
//
// Slot dirs scanned alphabetically; first available wins (deterministic).
//
// Locking: claim/release are serialized via proper-lockfile against the
// pool dir. Stale locks (holder process dead) are auto-recovered.
//
// Output:
//   slotDir: /absolute/path/to/slot
//   sessionName: ft-abc12345
//
// Usage:
//   forge-pool-claim.mjs <pool-dir> [claimant-id]
//
// Claimant ID defaults to ${CLAUDE_CODE_SESSION_ID:-pid-<pid>}.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { ensureRunnerDeps, loadFromRunner } from './forge-ensure-runner.mjs'

const poolArg = process.argv[2]
const claimant = process.argv[3] ?? process.env.CLAUDE_CODE_SESSION_ID ?? `pid-${process.pid}`

if (!poolArg) {
  console.error('Usage: forge-pool-claim.mjs <pool-dir> [claimant-id]')
  process.exit(2)
}

const poolDir = resolve(poolArg)
if (!existsSync(poolDir) || !statSync(poolDir).isDirectory()) {
  console.error(`forge-pool-claim: pool dir does not exist: ${poolDir}`)
  process.exit(3)
}

// Derive forgeRoot from pool dir: <forge>/.pool/ → forgeRoot = parent of poolDir
const forgeRoot = dirname(poolDir)

// Ensure runner deps are installed before importing them. Idempotent if
// already present.
ensureRunnerDeps(forgeRoot)

const lockfile = await loadFromRunner(forgeRoot, 'proper-lockfile')
const writeFileAtomic = (await loadFromRunner(forgeRoot, 'write-file-atomic')).default

const release = await lockfile.lock(poolDir, {
  retries: { retries: 20, minTimeout: 50, maxTimeout: 200 },
  stale: 30_000,
  realpath: false,
})

try {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const timestampedClaim = `${claimant}@${now}`

  let entries
  try {
    entries = readdirSync(poolDir).sort()
  } catch {
    entries = []
  }

  let claimed = null
  for (const name of entries) {
    if (!name.startsWith('slot-')) continue
    const slotDir = join(poolDir, name)
    const stateFile = join(slotDir, 'state.json')
    if (!existsSync(stateFile)) continue

    let state
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf8'))
    } catch {
      continue  // malformed; skip
    }

    if (state.checkedOutBy) continue

    // Available — claim it.
    state.checkedOutBy = timestampedClaim
    state.lastClaimed = now

    // Compute or retain the session name. Eight hex chars from md5(slotDir)
    // is collision-free in practice for a per-project pool and lets the
    // session be re-acquired across claims (chromium-warmth preservation).
    if (!state.playwrightSessionName) {
      const hash = createHash('md5').update(slotDir).digest('hex').slice(0, 8)
      state.playwrightSessionName = `ft-${hash}`
    }

    await writeFileAtomic(stateFile, JSON.stringify(state, null, 2) + '\n')

    claimed = { slotDir, sessionName: state.playwrightSessionName }
    break
  }

  if (!claimed) {
    console.error('EXHAUSTED')
    process.exit(1)
  }

  console.log(`slotDir: ${claimed.slotDir}`)
  console.log(`sessionName: ${claimed.sessionName}`)
} finally {
  await release()
}
