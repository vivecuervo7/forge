#!/usr/bin/env node
// forge-ensure-runner.mjs — make sure the project has a Playwright runner ready.
//
// If the project has its own Playwright setup (a playwright.config.{ts,js,mjs}
// alongside node_modules/@playwright/test at or above the forge/ directory),
// the plugin's runner isn't needed and this script is a no-op.
//
// Otherwise, lazy-install the plugin-shipped Playwright runner at
// ~/.claude/.vive-claude/forge/runner/ so the first `--spec` invocation
// doesn't pay the ~30s npm-install cost. The install is user-global and
// idempotent — once it lands here, every forge project on the machine
// shares it.
//
// Exposed for two callers:
//   - forge-init.sh invokes the CLI form at end of scaffold so the cost
//     surfaces at the discoverable moment ("init is taking a moment"
//     reads better than "first verification is taking a moment").
//   - forge-pool-run-spec.mjs imports `ensurePluginRunner` for the
//     just-in-time path (covers cases where /forge init wasn't run
//     recently and the runner is missing).
//
// Usage (CLI):
//   forge-ensure-runner.mjs <project-forge-dir>
//
// Exit codes:
//   0   runner ready (either project's own, or plugin runner present)
//   2   usage error
//   3   install failed

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const PLUGIN_RUNNER_ROOT = join(homedir(), '.claude', '.vive-claude', 'forge', 'runner')
export const PLUGIN_PW_MARKER = join(PLUGIN_RUNNER_ROOT, 'node_modules', '@playwright', 'test')

// Walk up from a starting dir, looking for a Playwright runner:
//   - playwright.config.{ts,js,mjs} at the same level
//   - node_modules/@playwright/test at the same or any ancestor level
// Returns { rootDir, configPath } if found, null otherwise.
export function findProjectRunner(startDir) {
  let dir = startDir
  for (let i = 0; i < 8; i++) {  // bounded — don't walk to fs root
    const configCandidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs']
    const config = configCandidates.map(n => join(dir, n)).find(p => existsSync(p))
    const hasDep = existsSync(join(dir, 'node_modules', '@playwright', 'test'))
    if (config && hasDep) {
      return { rootDir: dir, configPath: config }
    }
    const parent = dirname(dir)
    if (parent === dir) break  // hit fs root
    dir = parent
  }
  return null
}

// Lazy-install the plugin-shipped Playwright runner. Idempotent — re-runs
// npm install if any declared dep is missing, so dep additions/version
// bumps land on existing installs.
export function ensurePluginRunner() {
  mkdirSync(PLUGIN_RUNNER_ROOT, { recursive: true })

  const pkgPath = join(PLUGIN_RUNNER_ROOT, 'package.json')
  const pkgContent = JSON.stringify({
    name: 'forge-spec-runner',
    private: true,
    description: 'Forge-managed Playwright workspace for running generated specs. Maintained by forge-ensure-runner.mjs.',
    dependencies: {
      '@playwright/test': '^1.49.0',
      dotenv: '^16.4.0',
    },
  }, null, 2) + '\n'
  // Overwrite on every install attempt so version bumps land deterministically.
  writeFileSync(pkgPath, pkgContent)

  console.error(`forge-ensure-runner: installing plugin runner deps in ${PLUGIN_RUNNER_ROOT}/ (~30s on first run)…`)
  const result = spawnSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--no-progress'], {
    cwd: PLUGIN_RUNNER_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(
      `npm install failed in ${PLUGIN_RUNNER_ROOT}/ (exit ${result.status}). Investigate and re-run.`
    )
  }
  if (!existsSync(PLUGIN_PW_MARKER)) {
    throw new Error(
      `npm install completed but @playwright/test still missing at ${PLUGIN_PW_MARKER}. This shouldn't happen — check the runner dir.`
    )
  }
}

// Combined "ensure a runner is ready for this project" routine. Detects
// project-owned runner first; falls back to installing the plugin runner.
// Returns a string describing what's in place.
export function ensureRunnerReady(projectForge) {
  if (!existsSync(projectForge)) {
    throw new Error(`forge-ensure-runner: project forge dir does not exist: ${projectForge}`)
  }
  const searchStart = dirname(projectForge)
  const projectRunner = findProjectRunner(searchStart)
  if (projectRunner) {
    return `project runner at ${projectRunner.rootDir} — plugin runner not needed`
  }
  if (existsSync(PLUGIN_PW_MARKER)) {
    return `plugin runner already installed at ${PLUGIN_RUNNER_ROOT}`
  }
  ensurePluginRunner()
  return `plugin runner installed at ${PLUGIN_RUNNER_ROOT}`
}

// CLI entry point.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const projectForge = process.argv[2]
  if (!projectForge) {
    console.error('Usage: forge-ensure-runner.mjs <project-forge-dir>')
    process.exit(2)
  }
  try {
    const status = ensureRunnerReady(projectForge)
    console.error(`forge-ensure-runner: ${status}`)
    process.exit(0)
  } catch (err) {
    console.error(`forge-ensure-runner: ${err.message}`)
    process.exit(3)
  }
}
