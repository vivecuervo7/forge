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
//      resolves, then run from forge/ using the project-committed config at
//      forge/playwright.config.ts (scaffolded by /forge-init). This is the
//      path for sandboxes and greenfield projects with no existing test setup.
//
// In both paths, --slot reads <slot>/.env (dotenv format) into a dict and
// merges it into the spawned process's env. Forge no longer requires direnv:
// slot env comes from a plain .env file the provisioning recipe writes.
// User direnv (whatever's in process.env when the wrapper starts) still
// takes precedence — it's the user's personal layer for 1Password, machine-
// specific overrides, etc.
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
//   6   plugin fallback selected but forge/playwright.config.ts missing
//       (project hasn't been /forge-init'd, or the config was deleted)

import { spawn } from 'node:child_process'
import { existsSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { loadSlotEnv, composedEnv } from './forge-slot-env.mjs'

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
  // Symlink plugin runner's node_modules into project's forge/ so resolution
  // works. The symlink is a pure build artifact (not user-facing) — kept lazy
  // here rather than in forge-init because it points at a user-global path
  // that doesn't exist until /forge has been run at least once.
  const projNodeModules = join(projectForge, 'node_modules')
  if (!existsSync(projNodeModules)) {
    symlinkSync(join(PLUGIN_RUNNER_ROOT, 'node_modules'), projNodeModules)
  }
  // The fallback playwright.config.ts is scaffolded by /forge-init (committed
  // to the project's forge/ dir). If it's missing, the project hasn't been
  // /forge-init'd — surface a clear error rather than silently writing one
  // (which would diverge from the convention).
  const fallbackConfig = join(projectForge, 'playwright.config.ts')
  if (!existsSync(fallbackConfig)) {
    die(
      `no project runner found above ${projectForge}, and the plugin-fallback ` +
      `config at ${fallbackConfig} doesn't exist. Run \`/forge-init\` in the ` +
      `project root to scaffold the fallback config (or create a root-level ` +
      `playwright.config.ts with your project's own runner setup).`,
      6
    )
  }
  cwd = projectForge
  const specRel = relative(projectForge, specPath)
  const pwArgs = ['playwright', 'test', specRel, '--workers=1']
  if (headed) pwArgs.push('--headed')
  cmd = 'npx'
  cmdArgs = pwArgs
}

console.error(`forge-pool-run-spec: using ${mode} runner`)

// Load slot env (if --slot provided) into a plain dict, then merge with
// process.env winning. User direnv (whatever's already in process.env when
// the wrapper starts) takes precedence over slot values — matches the
// design where direnv is the user's personal layer, not forge's mechanism.
const slotEnv = loadSlotEnv(slot)

const child = spawn(cmd, cmdArgs, {
  cwd,
  stdio: 'inherit',
  env: composedEnv(slotEnv),
})

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    die(`command not found: ${cmd}. Install it and retry.`, 5)
  }
  die(`spawn error: ${err.message}`, 5)
})

child.on('exit', (code) => process.exit(code ?? 1))
