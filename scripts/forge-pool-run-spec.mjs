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
//      (lazy-installed by ensurePluginRunner below on first use). We symlink
//      that runner's node_modules
//      into the project's forge/ dir so the spec's `import '@playwright/test'`
//      resolves, then run from forge/ using the project-committed config at
//      forge/playwright.config.ts (scaffolded by /forge init). This is the
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
//   forge-pool-run-spec.mjs --spec <path> [--slot <slot-dir>] [--headed] [--record] [--record-as <label>]
//
// --record sets FORGE_RECORD=1 in the spawn env. The forge-scaffolded
// playwright.config.ts honors this by enabling `use.video = 'on'` and
// `use.trace = 'on'`; projects with their own config can opt in by
// checking the same env var. With no opt-in, --record is a no-op.
//
// After the run, if --record produced a video.webm under the project's
// test-results/ dir, it's copied to <projectForge>/videos/ so it survives
// Playwright's between-runs wipe of test-results. Filename is always
// <spec-basename>-<suffix>.webm; suffix is <YYYYMMDD-HHMMSS> by default
// or the user-supplied label when --record-as <label> is passed. Keeps
// the spec context attached so labels stay scoped per spec — multiple
// specs can each have their own "before" / "after" without colliding.
//
// Exit codes:
//   0   spec passed
//   1   spec failed (playwright reports test failure)
//   2   usage / arg error
//   3   plugin fallback selected but plugin runner not bootstrapped
//   4   spec file not found
//   5   spawn error (command missing, etc.)
//   6   plugin fallback selected but forge/playwright.config.ts missing
//       (project hasn't been /forge init'd, or the config was deleted)

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
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
let record = false
let recordAs = null

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
  } else if (arg === '--record') {
    record = true
  } else if (arg === '--record-as') {
    if (i + 1 >= argv.length) die('--record-as requires a label')
    recordAs = argv[++i]
    record = true  // --record-as implies --record
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
    ensurePluginRunner()
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
  // The fallback playwright.config.ts is scaffolded by /forge init (committed
  // to the project's forge/ dir). If it's missing, the project hasn't been
  // /forge init'd — surface a clear error rather than silently writing one
  // (which would diverge from the convention).
  const fallbackConfig = join(projectForge, 'playwright.config.ts')
  if (!existsSync(fallbackConfig)) {
    die(
      `no project runner found above ${projectForge}, and the plugin-fallback ` +
      `config at ${fallbackConfig} doesn't exist. Run \`/forge init\` in the ` +
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

// FORGE_RECORD is read by the forge-scaffolded playwright.config.ts to
// enable video + trace. User env precedence still wins, so an explicit
// FORGE_RECORD=0 in the shell can suppress recording even with --record.
const baseEnv = composedEnv(slotEnv)
const finalEnv = record ? { FORGE_RECORD: '1', ...baseEnv } : baseEnv

// Note the start time so we can find videos produced by THIS run (and
// ignore stale artifacts from earlier runs).
const runStartedAt = Date.now()

const child = spawn(cmd, cmdArgs, {
  cwd,
  stdio: 'inherit',
  env: finalEnv,
})

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    die(`command not found: ${cmd}. Install it and retry.`, 5)
  }
  die(`spawn error: ${err.message}`, 5)
})

child.on('exit', (code) => {
  // Recording persistence: copy any video.webm produced under
  // <projectForge>/test-results to <projectForge>/videos/ before exit.
  // Done before process.exit so the artifact survives even if the run
  // itself failed (a failure recording is often more useful than a
  // passing one for debugging).
  if (record) {
    persistRecording().catch((err) => {
      console.error(`forge-pool-run-spec: recording persistence failed: ${err.message}`)
    })
  }
  process.exit(code ?? 1)
})

function persistRecording() {
  return new Promise((resolve) => {
    const testResults = join(projectForge, 'test-results')
    if (!existsSync(testResults)) {
      resolve()
      return
    }

    // Walk test-results for *.webm files newer than runStartedAt.
    const videos = findFilesNewerThan(testResults, /\.webm$/, runStartedAt)
    if (videos.length === 0) {
      resolve()
      return
    }

    const videosDir = join(projectForge, 'videos')
    mkdirSync(videosDir, { recursive: true })

    // Filename is always <spec-basename>-<suffix>.webm. Suffix is the
    // user-supplied label (--record-as) or a timestamp by default.
    // Multiple videos in a single run is rare (one test, one video) but
    // possible. If there are multiple AND --record-as was given, only
    // the first gets the bare label — the rest get the label plus an
    // index to avoid silently overwriting.
    const specBase = basename(specPath).replace(/\.spec\.[tj]s$/, '')
    const suffix = recordAs || timestamp()
    for (let i = 0; i < videos.length; i++) {
      const src = videos[i]
      const indexed = videos.length > 1 ? `-${i + 1}` : ''
      const name = `${specBase}-${suffix}${indexed}.webm`
      const dest = join(videosDir, name)
      copyFileSync(src, dest)
      console.error(`forge-pool-run-spec: persisted recording → ${dest}`)
    }
    resolve()
  })
}

function findFilesNewerThan(dir, pattern, sinceMs) {
  const results = []
  function walk(d) {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (pattern.test(e.name)) {
        try {
          const st = statSync(p)
          if (st.mtimeMs >= sinceMs) results.push(p)
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  walk(dir)
  return results
}

function ensurePluginRunner() {
  // Lazy-install the plugin-shipped Playwright runner the first time a spec
  // needs it. Idempotent — re-runs npm install if any declared dep is missing,
  // so dep additions/version bumps land on existing installs.
  mkdirSync(PLUGIN_RUNNER_ROOT, { recursive: true })

  const pkgPath = join(PLUGIN_RUNNER_ROOT, 'package.json')
  const pkgContent = JSON.stringify({
    name: 'forge-spec-runner',
    private: true,
    description: 'Forge-managed Playwright workspace for running generated specs. Maintained by forge-pool-run-spec.mjs.',
    dependencies: {
      '@playwright/test': '^1.49.0',
      dotenv: '^16.4.0',
    },
  }, null, 2) + '\n'
  // Overwrite on every install attempt so version bumps land deterministically.
  writeFileSync(pkgPath, pkgContent)

  console.error(`forge-pool-run-spec: installing plugin runner deps in ${PLUGIN_RUNNER_ROOT}/ (~30s on first run)…`)
  const result = spawnSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--no-progress'], {
    cwd: PLUGIN_RUNNER_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    die(
      `npm install failed in ${PLUGIN_RUNNER_ROOT}/ (exit ${result.status}). ` +
      `Investigate and re-run.`,
      3
    )
  }
  if (!existsSync(PLUGIN_PW_MARKER)) {
    die(
      `npm install completed but @playwright/test still missing at ` +
      `${PLUGIN_PW_MARKER}. This shouldn't happen — check the runner dir.`,
      3
    )
  }
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}
