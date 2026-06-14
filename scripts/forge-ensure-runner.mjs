#!/usr/bin/env node
// forge-ensure-runner.mjs — make sure the project has a Playwright runner ready.
//
// Runner location is per-project: <forgeRoot>/.runner/. Self-contained,
// visible in the IDE, removed cleanly with the project. No user-global
// install location to maintain or clean up.
//
// Two paths:
//
//   1. If the project has its own Playwright (a playwright.config.{ts,js,mjs}
//      + node_modules/@playwright/test at or above the forge/ directory), the
//      plugin's runner isn't needed — this script is a no-op.
//
//   2. Otherwise, lazy-install at <forgeRoot>/.runner/ so the first spec or
//      snippet invocation doesn't pay the npm-install cost mid-run. Carries
//      esbuild (snippet bundling), @playwright/test (spec running), and
//      dotenv (env loading).
//
// Exposed for callers:
//   - forge-init.mjs invokes the CLI form at end of scaffold so the cost
//     surfaces at a discoverable moment.
//   - forge-pool-run-spec.mjs imports `ensureRunnerReady` for the just-in-time
//     path on first spec verification.
//   - forge-pool-invoke-snippet.mjs imports `ensureBundlerAvailable` to make
//     sure esbuild is installed before bundling.
//
// Usage (CLI):
//   forge-ensure-runner.mjs <project-forge-dir>
//
// Exit codes:
//   0   runner ready (either project's own, or plugin runner present)
//   2   usage error
//   3   install failed

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Path helpers — runner location is per-project, parameterized by forgeRoot.

export function runnerRootFor(forgeRoot) {
  return join(forgeRoot, '.runner')
}
export function pwMarkerFor(forgeRoot) {
  return join(runnerRootFor(forgeRoot), 'node_modules', '@playwright', 'test')
}
export function esbuildBinFor(forgeRoot) {
  return join(runnerRootFor(forgeRoot), 'node_modules', '.bin', 'esbuild')
}

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

// Lazy-install the plugin-shipped Playwright runner into <forgeRoot>/.runner/.
// Idempotent — re-runs npm install if any declared dep is missing, so dep
// additions or version bumps land on existing installs.
export function ensurePluginRunner(forgeRoot) {
  const runnerRoot = runnerRootFor(forgeRoot)
  mkdirSync(runnerRoot, { recursive: true })

  const pkgPath = join(runnerRoot, 'package.json')
  const pkgContent = JSON.stringify({
    name: 'forge-spec-runner',
    private: true,
    description: 'Forge-managed Playwright workspace. Maintained by forge-ensure-runner.mjs. Safe to delete forge/.runner/ to reset.',
    dependencies: {
      '@playwright/test': '^1.49.0',
      dotenv: '^16.4.0',
      esbuild: '^0.24.0',
      execa: '^9.5.0',
      'find-process': '^1.4.0',
      mri: '^1.2.0',
      'proper-lockfile': '^4.1.0',
      'tree-kill': '^1.2.0',
      'write-file-atomic': '^6.0.0',
    },
  }, null, 2) + '\n'
  // Overwrite on every install attempt so version bumps land deterministically.
  writeFileSync(pkgPath, pkgContent)

  console.error(`forge-ensure-runner: installing runner deps in ${runnerRoot}/ (~30s on first run)…`)
  const result = spawnSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--no-progress'], {
    cwd: runnerRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(
      `npm install failed in ${runnerRoot}/ (exit ${result.status}). Investigate and re-run.`
    )
  }
  if (!existsSync(pwMarkerFor(forgeRoot))) {
    throw new Error(
      `npm install completed but @playwright/test still missing at ${pwMarkerFor(forgeRoot)}. ` +
      `Check ${runnerRoot}/ for install errors.`
    )
  }
}

// Ensure the project's .runner/ deps are installed. Sentinel is the esbuild
// bin — once npm install succeeds, every dep in package.json is present, so
// checking the smallest known artifact is enough.
//
// Used independently of project-runner detection: even projects with their
// own Playwright need .runner/ for plugin-side deps (execa, mri,
// proper-lockfile, etc.) used by the pool, invoke, and spec-run scripts.
//
// Triggers a full install if the sentinel is missing. First call per project
// pays the ~30s cost; subsequent calls are free.
export function ensureRunnerDeps(forgeRoot) {
  if (existsSync(esbuildBinFor(forgeRoot))) return
  ensurePluginRunner(forgeRoot)
  if (!existsSync(esbuildBinFor(forgeRoot))) {
    throw new Error(
      `forge-ensure-runner: runner deps missing at ${runnerRootFor(forgeRoot)} after npm install.`
    )
  }
}

// Backward-compat alias — kept until all callers migrate.
export const ensureBundlerAvailable = ensureRunnerDeps

// Load a runner-installed dep from the plugin script side. Used by pool +
// invoke + spec-run scripts to import packages they need (execa, mri,
// proper-lockfile, etc.) from the project's <forgeRoot>/.runner/ install.
//
// Handles both CJS and ESM deps via dynamic import on the resolved file
// path. Returns the module's namespace object — destructure named exports
// where present, or use `.default` for CJS-style default exports.
//
// Callers should `ensureBundlerAvailable(forgeRoot)` or equivalent first
// to guarantee the runner is installed.
export async function loadFromRunner(forgeRoot, name) {
  const req = createRequire(join(runnerRootFor(forgeRoot), 'package.json'))
  const resolved = req.resolve(name)
  return import(pathToFileURL(resolved).href)
}

// Combined "ensure a runner is ready for this project" routine. Detects
// project-owned runner first; falls back to installing the plugin runner.
// Returns a string describing what's in place.
export function ensureRunnerReady(forgeRoot) {
  if (!existsSync(forgeRoot)) {
    throw new Error(`forge-ensure-runner: forge dir does not exist: ${forgeRoot}`)
  }
  const searchStart = dirname(forgeRoot)
  const projectRunner = findProjectRunner(searchStart)
  if (projectRunner) {
    return `project runner at ${projectRunner.rootDir} — plugin runner not needed`
  }
  if (existsSync(pwMarkerFor(forgeRoot))) {
    return `plugin runner already installed at ${runnerRootFor(forgeRoot)}`
  }
  ensurePluginRunner(forgeRoot)
  return `plugin runner installed at ${runnerRootFor(forgeRoot)}`
}

// CLI entry point.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const forgeRoot = process.argv[2]
  if (!forgeRoot) {
    console.error('Usage: forge-ensure-runner.mjs <project-forge-dir>')
    process.exit(2)
  }
  try {
    const status = ensureRunnerReady(forgeRoot)
    console.error(`forge-ensure-runner: ${status}`)
    process.exit(0)
  } catch (err) {
    console.error(`forge-ensure-runner: ${err.message}`)
    process.exit(3)
  }
}
