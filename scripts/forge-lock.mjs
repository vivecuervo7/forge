// forge-lock.mjs — minimal cross-platform mutex for forge pool operations.
//
// Pool claim/release ran under platform locks (flock on Linux, lockf on
// macOS) in the .sh-era. Going Node-native means we can't rely on either.
// This implements a simple mkdir-based mutex that works on all three OSes:
//
//   - mkdirSync with recursive:false is atomic everywhere — first caller
//     wins, subsequent callers get EEXIST.
//   - Lock is auto-released in a `finally` block.
//   - Stale-lock recovery: PID is written into the lock dir; if a contending
//     caller finds the holder process is dead, it force-removes and retries.
//
// Single-machine, low-contention design — adequate for forge's pool where
// only a handful of concurrent claims happen even at peak.

import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)  // signal 0 tests existence without actually signaling
    return true
  } catch {
    return false
  }
}

/**
 * Acquire `lockDir`, run `fn`, release the lock. Returns whatever fn returns.
 *
 * @param {string} lockDir       absolute path to the lock dir to create
 * @param {() => any} fn         work to run while holding the lock (may be async)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000]   max wait before throwing
 * @param {number} [opts.retryMs=50]        delay between acquire attempts
 */
export async function withLock(lockDir, fn, { timeoutMs = 10000, retryMs = 50 } = {}) {
  const pidFile = join(lockDir, 'pid')
  const start = Date.now()

  while (true) {
    try {
      mkdirSync(lockDir, { recursive: false })
      writeFileSync(pidFile, String(process.pid))
      break  // acquired
    } catch (e) {
      if (e.code !== 'EEXIST') throw e

      // Check if the holder is still alive — if not, force-clear the stale lock.
      try {
        const holderPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
        if (holderPid && !isProcessAlive(holderPid)) {
          rmSync(lockDir, { recursive: true, force: true })
          continue  // immediate retry
        }
      } catch {
        // pid file unreadable — assume race with another acquirer; back off normally
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `forge-lock: failed to acquire ${lockDir} after ${timeoutMs}ms. ` +
          `If you're sure no other forge process is running, remove the lock dir manually.`
        )
      }
      await new Promise(r => setTimeout(r, retryMs))
    }
  }

  try {
    return await fn()
  } finally {
    rmSync(lockDir, { recursive: true, force: true })
  }
}
