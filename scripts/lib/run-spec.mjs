// run-spec — run a project's forge spec, preferring the project's
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
//      projects (monorepos, apps with existing test suites) where the runner
//      is part of the dev workflow.
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
//   forge-cli.mjs run-spec --spec <path> [--headed] [--dashboard] [--record] [--record-as <label>] [--slow-mo <ms>]
//
// --dashboard makes the (headless) run watchable in the Playwright dashboard:
// a free CDP port is exposed via FORGE_SPEC_CDP (honored by the forge-
// scaffolded config; projects with their own config opt in the same way),
// and a playwright-cli session is attached to the run's browser for its
// duration — it appears in the dashboard as `spec-<name>` and detaches when
// the run ends. Best-effort at every step: the run itself never fails
// because the viewing rig didn't come up. Pair with --slow-mo to make a
// fast replay watchable.
//
// --record sets FORGE_RECORD=1 in the spawn env. The forge-scaffolded
// playwright.config.ts honors this by enabling `use.video = 'on'` and
// `use.trace = 'on'`; projects with their own config can opt in by
// checking the same env var. With no opt-in, --record is a no-op.
//
// --slow-mo <ms> sets FORGE_SLOW_MO=<ms> in the spawn env. The forge-
// scaffolded playwright.config.ts honors this by setting
// `use.launchOptions.slowMo = <ms>`, inserting a fixed pause after every
// Playwright action. Useful as a retry lever when a spec fails on
// async-state-machine UI libraries (Kendo, Angular Material with
// deferred change detection, etc.) where the driver's headed pace
// masked a race the headless spec exposed. Projects with
// their own playwright config opt in by reading FORGE_SLOW_MO the same
// way. With no opt-in, --slow-mo is a no-op.
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
//   7   stalled — the runner produced no output for FORGE_SPEC_STALL_SECS
//       (default 480; 0 disables) and was killed. This is an INACTIVITY
//       watchdog, not a wall-clock cap: the timer resets on every output
//       byte, so a long healthy run (chatty per test) never trips it. It
//       catches the wedged modes: npx hanging before a browser ever
//       spawns, or a runner surviving its own test timeout in silence.
//       A stalled exit means re-run, not "the spec failed".

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FORGE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'forge-cli.mjs')

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolvePort(port))
    })
    srv.on('error', reject)
  })
}

// Attach a playwright-cli session to the spec run's browser (exposed on the
// CDP port by the config) so the dashboard renders the run live. Runs
// concurrently with the test process; every step is best-effort.
async function attachForDashboard(port, session) {
  // Open the dashboard first — idempotent, no-ops when already up.
  spawnSync(process.execPath, [FORGE_CLI, 'dashboard'], { stdio: 'ignore' })
  const deadline = Date.now() + 20_000
  let up = false
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) { up = true; break }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!up) {
    console.error('forge-run-spec: --dashboard: the CDP port never came up — run continues unwatched')
    return false
  }
  const attach = spawnSync(
    process.execPath,
    [FORGE_CLI, 'pw', `-s=${session}`, 'attach', `--cdp=http://localhost:${port}`],
    { encoding: 'utf8' },
  )
  if (attach.status === 0) {
    console.error(`forge-run-spec: --dashboard: watching as session '${session}' in the Playwright dashboard`)
    return true
  }
  console.error('forge-run-spec: --dashboard: attach failed — run continues unwatched')
  return false
}
import {
  pwMarkerFor,
  findProjectRunner,
  ensurePluginRunner,
  ensureRunnerDeps,
  loadFromRunner,
} from './ensure-runner.mjs'
import { looksLikeForgeRoot } from './common.mjs'

function die(msg, code = 2) {
  console.error('forge-run-spec:', msg)
  process.exit(code)
}

// Bootstrap mri — needs forgeRoot, which we derive from the spec path. Read
// it from the raw args first.
function rawArgValue(av, name) {
  for (let i = 0; i < av.length; i++) {
    if (av[i] === name && i + 1 < av.length) return av[i + 1]
    if (av[i].startsWith(`${name}=`)) return av[i].slice(name.length + 1)
  }
  return null
}

export async function main(cliArgs) {
const rawSpec = rawArgValue(cliArgs, '--spec')
if (!rawSpec) die('missing --spec <path-to-spec>')
const specPathAbs = resolve(rawSpec)
if (!existsSync(specPathAbs)) die(`spec not found: ${specPathAbs}`, 4)
// Validate the derived forge root BEFORE ensureRunnerDeps — installing runner
// deps into a directory derived from an unvalidated path could overwrite an
// unrelated package.json (e.g. --spec ~/foo.spec.ts → homedir).
const provisionalForgeRoot = dirname(dirname(specPathAbs))
if (!looksLikeForgeRoot(provisionalForgeRoot)) {
  die(
    `spec at ${specPathAbs} doesn't appear to live under a forge/ directory ` +
    `(expected ${provisionalForgeRoot}/hints/ to exist). Check the path.`
  )
}
ensureRunnerDeps(provisionalForgeRoot)

const { default: mri } = await loadFromRunner(provisionalForgeRoot, 'mri')
const args = mri(cliArgs, {
  string: ['spec', 'record-as', 'slow-mo'],
  boolean: ['headed', 'record', 'dashboard'],
})
const dashboard = !!args.dashboard

const headed = !!args.headed
const recordAs = args['record-as'] ?? null
const record = !!args.record || recordAs !== null  // --record-as implies --record
const slowMoRaw = args['slow-mo']
let slowMo = null
if (slowMoRaw != null) {
  const n = parseInt(slowMoRaw, 10)
  if (!Number.isFinite(n) || n < 0) die(`--slow-mo expects a non-negative integer (ms), got ${slowMoRaw}`)
  slowMo = n
}

// Spec path + forge root were validated above, before ensureRunnerDeps.
const specPath = specPathAbs
const projectForge = provisionalForgeRoot

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
    // list for the human-watchable stream (inherited stdio); json (written to
    // PLAYWRIGHT_JSON_OUTPUT_NAME, set below) for forge to parse a structured
    // per-error outcome rather than scraping the list reporter's text.
    '--reporter=list,json',
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
  // list for the watchable stream, json (→ PLAYWRIGHT_JSON_OUTPUT_NAME) for
  // forge to parse a structured outcome. Overrides the config's reporter.
  const pwArgs = ['playwright', 'test', specRel, '--reporter=list,json', '--workers=1']
  if (headed) pwArgs.push('--headed')
  cmd = 'npx'
  cmdArgs = pwArgs
}

console.error(`forge-run-spec: using ${mode} runner`)

// FORGE_RECORD is read by the forge-scaffolded playwright.config.ts to
// enable video + trace. User env precedence wins — an explicit FORGE_RECORD=0
// in the shell can suppress recording even with --record.
// FORGE_SLOW_MO is read by the forge-scaffolded config to set Playwright's
// launchOptions.slowMo. Set explicitly via --slow-mo on this invocation; an
// unset value defers to whatever the project's config decides (often a
// baseline for async-state-machine UI libraries).
const finalEnv = { ...process.env }
if (record) finalEnv.FORGE_RECORD = '1'
if (slowMo != null) finalEnv.FORGE_SLOW_MO = String(slowMo)

// --dashboard: expose the run's browser over CDP (config honors
// FORGE_SPEC_CDP) so a playwright-cli session can attach and the dashboard
// can render the run live.
let cdpPort = 0
let dashboardSession = null
if (dashboard) {
  try {
    cdpPort = await freePort()
  } catch {
    console.error('forge-run-spec: --dashboard: no free port — run continues unwatched')
  }
  if (cdpPort) {
    finalEnv.FORGE_SPEC_CDP = String(cdpPort)
    dashboardSession = ('spec-' + basename(specPath).replace(/\.spec\.[tj]s$/, ''))
      .slice(0, 16)
      .replace(/-+$/, '')
  }
}

// Structured outcome: Playwright's json reporter writes to the file named by
// PLAYWRIGHT_JSON_OUTPUT_NAME (kept out of the inherited stdout, which carries
// the list reporter). It lives in a forge-owned dir OUTSIDE test-results/ so
// the exit-0 cleanup below doesn't wipe it. Reset it each run so a stale file
// from a previous run can't be mistaken for this run's outcome.
const lastRunDir = join(projectForge, '.last-run')
const jsonOutPath = join(lastRunDir, 'results.json')
try {
  rmSync(lastRunDir, { recursive: true, force: true })
  mkdirSync(lastRunDir, { recursive: true })
} catch {
  // best-effort — a missing outcome file is handled gracefully below
}
finalEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonOutPath

// Note the start time so we can find videos produced by THIS run (and
// ignore stale artifacts from earlier runs).
const runStartedAt = Date.now()

const { execa } = await loadFromRunner(projectForge, 'execa')

// Inactivity watchdog (see exit code 7 in the header). Output is piped (not
// inherited) so every byte both forwards to the caller and re-arms the timer.
const stallSecs = (() => {
  const raw = process.env.FORGE_SPEC_STALL_SECS
  if (raw == null || raw === '') return 480
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 480
})()

let exitCode = 1
let stalled = false
let attachDone = Promise.resolve(false)
try {
  const subprocess = execa(cmd, cmdArgs, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: finalEnv,
    reject: false,  // capture non-zero exits without throwing
  })
  let stallTimer = null
  const armStall = () => {
    if (!stallSecs) return
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      stalled = true
      subprocess.kill('SIGTERM')
      setTimeout(() => subprocess.kill('SIGKILL'), 5000).unref()
    }, stallSecs * 1000)
  }
  subprocess.stdout.on('data', (chunk) => { process.stdout.write(chunk); armStall() })
  subprocess.stderr.on('data', (chunk) => { process.stderr.write(chunk); armStall() })
  armStall()
  // Concurrent with the run: wait for the CDP port, attach the dashboard view.
  if (dashboardSession) attachDone = attachForDashboard(cdpPort, dashboardSession)
  const result = await subprocess
  clearTimeout(stallTimer)
  exitCode = result.exitCode ?? 1
} catch (err) {
  if (err.code === 'ENOENT') {
    die(`command not found: ${cmd}. Install it and retry.`, 5)
  }
  die(`spawn error: ${err.message}`, 5)
}

// The run's browser dies with the run; detach clears the session from the
// dashboard's registry (best-effort — a failed attach makes this a no-op).
if (dashboardSession) {
  await attachDone.catch(() => false)
  spawnSync(process.execPath, [FORGE_CLI, 'pw', `-s=${dashboardSession}`, 'detach'], { stdio: 'ignore' })
}

if (stalled) {
  // Advisory only — no reaping. Long sessions can legitimately own browser
  // processes; the diagnostic just says whether one exists to look at.
  let browserSeen = false
  try {
    const { execSync } = await import('node:child_process')
    execSync('pgrep -f "chrome-for-testing|ms-playwright"', { stdio: 'ignore' })
    browserSeen = true
  } catch { /* none found */ }
  console.error(
    `forge-run-spec: stalled — no output for ${stallSecs}s; killed the runner. ` +
    (browserSeen
      ? 'A Playwright-managed browser process is still present — it may be orphaned; check before re-running.'
      : 'No Playwright-managed browser process was found — the runner likely wedged before launching one.') +
    ' This is a wedged run, not a spec verdict: re-run once; if it stalls again, escalate.' +
    ' (Tune via FORGE_SPEC_STALL_SECS; 0 disables.)'
  )
  process.exit(7)
}

// Print a compact, structured outcome from the json reporter so the verifier
// reads per-error file:line on solid data rather than scraping the list
// reporter's text. The exit code remains authoritative for pass/fail; this is
// additive context.
printOutcomeSummary(jsonOutPath, exitCode)

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

// Parse Playwright's json report into a compact, per-error summary printed to
// stderr. Best-effort: a missing/unparseable file never changes the exit code
// — it just means the verifier falls back to the list reporter text.
function printOutcomeSummary(jsonPath, exitCode) {
  if (!existsSync(jsonPath)) {
    console.error('forge-run-spec: no structured outcome (json reporter produced no file)')
    return
  }
  let report
  try {
    report = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch (err) {
    console.error(`forge-run-spec: outcome json unreadable (${err.message}) — rely on the list reporter above`)
    return
  }

  const stripAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '')
  const firstLine = (s) => stripAnsi(s).split('\n').find((l) => l.trim().length) ?? ''

  // Flatten the nested suites → specs tree into one list of spec outcomes.
  const specs = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const errors = []
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          for (const e of r.errors ?? []) {
            const loc = e.location ? `${relative(projectForge, e.location.file)}:${e.location.line}` : '(no location)'
            errors.push({ loc, message: firstLine(e.message) })
          }
        }
      }
      specs.push({ title: spec.title, ok: spec.ok !== false && errors.length === 0, errors })
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)

  console.error('forge-run-spec: outcome summary (json reporter) ----------------------')
  console.error(`  overall: ${exitCode === 0 ? 'passed' : 'failed'} (exit ${exitCode})`)
  if (specs.length === 0) {
    console.error('  (no specs reported)')
  }
  for (const s of specs) {
    console.error(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.title}`)
    for (const e of s.errors) {
      console.error(`      ↳ ${e.loc} — ${e.message}`)
    }
  }
  console.error('  (soft-assertion failures appear as errors here even though the run completed)')
  console.error('--------------------------------------------------------------------------')
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
}
