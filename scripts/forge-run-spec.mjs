#!/usr/bin/env node
// forge-run-spec.mjs — run a project's forge spec, preferring the project's
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
//   2. PLUGIN-SHIPPED FALLBACK. If no project runner exists, install (lazily)
//      into the project's forge/ directory itself. The spec's `import
//      '@playwright/test'` resolves naturally from <forge>/node_modules.
//      Runs from forge/ using the project-committed config at
//      forge/playwright.config.ts (scaffolded by /forge init). This is the
//      path for sandboxes and greenfield projects with no existing test setup.
//
// Env handling: the spec reads `process.env.X` directly. Whatever's in
// process.env at spawn time is what the spec sees — the user's shell
// environment (direnv, manual exports, dotenv-cli, whatever) plus
// anything the project's playwright config explicitly loads. The
// scaffolded playwright config has a commented-out dotenv import line
// for projects that want forge to load `forge/.env` on each run; opt in
// by uncommenting.
//
// Usage:
//   forge-run-spec.mjs --spec <path> [--headed] [--record] [--record-as <label>]
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

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import {
  pwMarkerFor,
  findProjectRunner,
  ensurePluginRunner,
  ensureRunnerDeps,
  loadFromRunner,
} from './forge-ensure-runner.mjs'

function die(msg, code = 2) {
  console.error('forge-run-spec:', msg)
  process.exit(code)
}

// Bootstrap mri — needs forgeRoot, which we derive from the spec path. Read
// it from raw argv first.
function rawArgValue(name) {
  const av = process.argv.slice(2)
  for (let i = 0; i < av.length; i++) {
    if (av[i] === name && i + 1 < av.length) return av[i + 1]
    if (av[i].startsWith(`${name}=`)) return av[i].slice(name.length + 1)
  }
  return null
}

const rawSpec = rawArgValue('--spec')
if (!rawSpec) die('missing --spec <path-to-spec>')
const specPathAbs = resolve(rawSpec)
const provisionalForgeRoot = dirname(dirname(specPathAbs))
ensureRunnerDeps(provisionalForgeRoot)

const { default: mri } = await loadFromRunner(provisionalForgeRoot, 'mri')
const args = mri(process.argv.slice(2), {
  string: ['spec', 'record-as'],
  boolean: ['headed', 'record'],
})

let specPath = args.spec
if (!specPath) die('missing --spec <path-to-spec>')

const headed = !!args.headed
const recordAs = args['record-as'] ?? null
const record = !!args.record || recordAs !== null  // --record-as implies --record

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

// findProjectRunner + ensurePluginRunner are shared with forge-init.mjs via
// forge-ensure-runner.mjs (imported above). /forge init pre-installs the
// plugin runner if no project runner is detected, so the path below where
// we'd install it lazily is now a fallback rather than the primary trigger.

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
  // Path 2: plugin-shipped fallback (project-local at <projectForge>/)
  if (!existsSync(pwMarkerFor(projectForge))) {
    try {
      ensurePluginRunner(projectForge)
    } catch (err) {
      die(err.message, 3)
    }
  }
  mode = `plugin (${projectForge})`
  // No symlink needed — node_modules lives directly in forge/, so Node's
  // module resolution from <forge>/specs/<name>.spec.ts walks up one level
  // and finds @playwright/test naturally.
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

console.error(`forge-run-spec: using ${mode} runner`)

// FORGE_RECORD is read by the forge-scaffolded playwright.config.ts to
// enable video + trace. User env precedence wins — an explicit FORGE_RECORD=0
// in the shell can suppress recording even with --record.
const finalEnv = record ? { ...process.env, FORGE_RECORD: '1' } : { ...process.env }

// Note the start time so we can find videos produced by THIS run (and
// ignore stale artifacts from earlier runs).
const runStartedAt = Date.now()

const { execa } = await loadFromRunner(projectForge, 'execa')

let exitCode = 1
try {
  const result = await execa(cmd, cmdArgs, {
    cwd,
    stdio: 'inherit',
    env: finalEnv,
    reject: false,  // capture non-zero exits without throwing
  })
  exitCode = result.exitCode ?? 1
} catch (err) {
  if (err.code === 'ENOENT') {
    die(`command not found: ${cmd}. Install it and retry.`, 5)
  }
  die(`spawn error: ${err.message}`, 5)
}

// Recording persistence: copy any video.webm produced under
// <projectForge>/test-results to <projectForge>/videos/ before exit.
// Done before process.exit so the artifact survives even if the run
// itself failed (a failure recording is often more useful than a
// passing one for debugging).
if (record) {
  try {
    await persistRecording()
  } catch (err) {
    console.error(`forge-run-spec: recording persistence failed: ${err.message}`)
  }
}

// Clean up test-results/ on success. Playwright's working directory
// contains video.webm (already copied to forge/videos/ above), trace
// artifacts (only present on failure per playwright config's
// retain-on-failure setting), and other Playwright internals — none
// of which the user asked for. On failure, leave it intact so the
// trace + any other diagnostic artifacts survive for debugging.
if (exitCode === 0) {
  const testResults = join(projectForge, 'test-results')
  if (existsSync(testResults)) {
    try {
      rmSync(testResults, { recursive: true, force: true })
    } catch (err) {
      console.error(`forge-run-spec: test-results cleanup failed: ${err.message}`)
    }
  }
}

process.exit(exitCode)

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
      console.error(`forge-run-spec: persisted recording → ${dest}`)
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
