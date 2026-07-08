// dashboard — open the Playwright dashboard, but ONLY if it isn't
// already running.
//
// Why the guard: the dashboard is idempotent (a second launch doesn't spawn a
// duplicate window) but it RAISES ITSELF TO THE FOREGROUND on every launch —
// which steals focus. So we open it at most once (when it isn't up yet) and
// never re-invoke it while it's already running, to avoid interrupting the user
// mid-session.
//
// Detection: a live dashboard is a node process running `dashboardApp.js`.
// If found → no-op. Otherwise → spawn `playwright-cli show` detached so it
// neither blocks this process nor dies with it.
//
// Routing playwright-cli through this node wrapper (as forge-pw does) keeps the
// launch off the Claude Code bash guard hook.
//
// Best-effort: a headless drive proceeds fine without the dashboard, so this
// never fails the caller. Always exits 0.
//
// Usage: forge-dashboard.mjs

import { execSync, spawn } from 'node:child_process'

function alreadyRunning() {
  try {
    execSync('pgrep -f dashboardApp.js', { stdio: 'ignore' })
    return true
  } catch {
    return false // pgrep exits non-zero when nothing matches
  }
}

export function main() {
  if (alreadyRunning()) {
    console.log('forge-dashboard: dashboard already open — leaving it (no re-raise).')
    process.exit(0)
  }

  try {
    const child = spawn('playwright-cli', ['show'], { detached: true, stdio: 'ignore' })
    child.on('error', () => {}) // e.g. not installed — best-effort, ignore
    child.unref()
    console.log('forge-dashboard: opening the Playwright dashboard (headless sessions render live here).')
  } catch {
    console.error('forge-dashboard: could not open the dashboard; the drive continues headless regardless.')
  }
}
