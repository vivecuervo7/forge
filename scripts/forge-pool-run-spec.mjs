#!/usr/bin/env node
// forge-pool-run-spec.mjs — run a project's forge spec, preferring the project's
// own Playwright runner over the plugin-shipped fallback.
//
// Two paths, picked at runtime:
//
//   1. PROJECT RUNNER (preferred). If the project has its own Playwright setup
//      (a `playwright.config.ts`/`.js` and `node_modules/@playwright/test` at
//      or above the forge/ directory), use it. We invoke:
//          npx playwright test <abs-path-to-spec> --config=<project-config>
//      from the project root. The project's globalSetup, fixtures, baseURL,
//      custom matchers, etc. all apply. This is the right answer for real
//      projects (EventsAir, monorepos) where the runner is part of the dev
//      workflow.
//
//   2. PLUGIN-SHIPPED FALLBACK. If no project runner exists, lean on the
//      one-time-installed runner at ~/.claude/.vive-claude/forge/runner/
//      (set up by forge-bootstrap.sh). We symlink that runner's node_modules
//      into the project's forge/ dir so the spec's `import '@playwright/test'`
//      resolves, then run from forge/ with no config. This is the path for
//      sandboxes and greenfield projects with no existing test setup.
//
// In both paths, --slot wraps the invocation with `direnv exec <slot>` so
// the slot's env (SAUCE_USERNAME, etc.) lands on the spec process.
//
// Usage:
//   forge-pool-run-spec.mjs --spec <path> [--slot <slot-dir>] [--headed]
//
// Exit codes:
//   0   spec passed
//   1   spec failed (playwright reports test failure)
//   2   usage / arg error
//   3   plugin fallback selected but plugin runner not bootstrapped
//   4   spec file not found
//   5   spawn error (command missing, etc.)

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname, relative } from 'node:path'

const PLUGIN_RUNNER_ROOT = join(homedir(), '.claude', '.vive-claude', 'forge', 'runner')
const PLUGIN_PW_MARKER = join(PLUGIN_RUNNER_ROOT, 'node_modules', '@playwright', 'test')

function die(msg, code = 2) {
  console.error('forge-pool-run-spec:', msg)
  process.exit(code)
}

const argv = process.argv.slice(2)

let specPath = null
let slot = null
let headed = false

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--spec') {
    if (i + 1 >= argv.length) die('--spec requires a path')
    specPath = argv[++i]
  } else if (arg === '--slot') {
    if (i + 1 >= argv.length) die('--slot requires a path')
    slot = argv[++i]
  } else if (arg === '--headed') {
    headed = true
  } else {
    die(`unknown arg: ${arg}`)
  }
}

if (!specPath) die('missing --spec <path-to-spec>')

specPath = resolve(specPath)
if (!existsSync(specPath)) die(`spec not found: ${specPath}`, 4)

// Locate the project's forge/ — assume the spec lives at <project>/forge/specs/<file>
const specsDir = dirname(specPath)
const projectForge = dirname(specsDir)
if (!existsSync(join(projectForge, 'hints'))) {
  die(
    `spec at ${specPath} doesn't appear to live under a forge/ directory ` +
    `(expected ${projectForge}/hints/ to exist). Check the path.`
  )
}

// Walk up from the project's forge/ dir, looking for a Playwright runner:
//   - playwright.config.{ts,js,mjs} at the same level
//   - node_modules/@playwright/test at the same or any ancestor level
// We require BOTH config + dependency at the same root.
function findProjectRunner(startDir) {
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

// Start the search at the project's parent dir — playwright.config typically
// lives at the project root, one level above forge/.
const searchStart = dirname(projectForge)
const projectRunner = findProjectRunner(searchStart)

let cmd, cmdArgs, cwd, mode

if (projectRunner) {
  // Path 1: project runner
  mode = `project (${relative(homedir(), projectRunner.rootDir) || '.'})`
  cwd = projectRunner.rootDir
  const pwArgs = [
    'playwright', 'test',
    specPath,  // absolute — playwright accepts this
    `--config=${projectRunner.configPath}`,
    '--reporter=list',
    '--workers=1',
  ]
  if (headed) pwArgs.push('--headed')
  cmd = 'npx'
  cmdArgs = pwArgs
} else {
  // Path 2: plugin-shipped fallback
  if (!existsSync(PLUGIN_PW_MARKER)) {
    die(
      `no project runner found above ${projectForge}, AND plugin runner is ` +
      `not bootstrapped at ${PLUGIN_RUNNER_ROOT}. Run \`/forge\` once to ` +
      `bootstrap the plugin runner (it installs @playwright/test there).`,
      3
    )
  }
  mode = `plugin (${PLUGIN_RUNNER_ROOT})`
  // Symlink plugin runner's node_modules into project's forge/ so resolution works
  const projNodeModules = join(projectForge, 'node_modules')
  if (!existsSync(projNodeModules)) {
    symlinkSync(join(PLUGIN_RUNNER_ROOT, 'node_modules'), projNodeModules)
  }
  // Scaffold a minimal playwright config in the project's forge/ dir so test
  // discovery works. Idempotent. Already gitignored by the standard forge/
  // .gitignore (`*` blanket). The config is intentionally minimal — projects
  // that want real config write their own playwright.config in the project
  // root and we take the project-runner branch above instead.
  const fallbackConfig = join(projectForge, 'playwright.config.ts')
  if (!existsSync(fallbackConfig)) {
    writeFileSync(fallbackConfig, `// Auto-generated by forge-pool-run-spec.mjs for plugin-fallback runs.
// If you want custom Playwright config, create your own playwright.config.ts
// at the project root (the wrapper will detect and prefer it).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
})
`)
  }
  cwd = projectForge
  const specRel = relative(projectForge, specPath)
  const pwArgs = ['playwright', 'test', specRel, '--workers=1']
  if (headed) pwArgs.push('--headed')
  cmd = 'npx'
  cmdArgs = pwArgs
}

console.error(`forge-pool-run-spec: using ${mode} runner`)

// Wrap with direnv exec if a slot is provided
if (slot) {
  cmdArgs = ['exec', slot, cmd, ...cmdArgs]
  cmd = 'direnv'
}

const child = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit' })

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    die(`command not found: ${cmd}. Install it and retry.`, 5)
  }
  die(`spawn error: ${err.message}`, 5)
})

child.on('exit', (code) => process.exit(code ?? 1))
