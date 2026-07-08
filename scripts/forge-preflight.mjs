#!/usr/bin/env node
// forge-preflight.mjs — the team-lead's run setup, as one command.
//
// Everything deterministic the lead does before spawning the teammates,
// bundled: locate the forge root, load the project's forge.md hints and the
// shared protocol contracts (escalation, collaborativeness), compute the
// cleanup-staleness nudge, validate the session name, open the browser
// session (headless unless told otherwise), and — when headless — open the
// Playwright dashboard. One call replaces the phase-by-phase tool-call
// preamble; the lead reads the output and goes straight to spawning.
//
// Judgment stays with the lead: it picks the session name and decides
// headed-vs-headless from the run's framing (teach mode, "watch", a
// forge.md preference) BEFORE calling this. Preflight honors the decision
// (--headed) plus the deterministic FORGE_HEADED env check, and reports
// which source decided. Project-specific setup (a `## Setup before each
// run` section in forge.md) is NOT executed here — it's project prose the
// lead follows; preflight just flags its presence.
//
// Output: a `# forge preflight: ok` line, a compact JSON summary, then the
// loaded file contents under `## <path>` headings (hints/forge.md and the
// two protocol files) so the caller needs no further reads.
//
// Usage:
//   forge-preflight.mjs --session <name> [--headed] [--no-open]
//
//   --session <name>  the playwright-cli session to open (validated: the
//                     macOS socket-path limit caps it at 16 chars)
//   --headed          open the browser headed (default headless; FORGE_HEADED=1
//                     in the env also selects headed)
//   --no-open         skip the browser + dashboard (dry preflight — for
//                     re-reading hints/protocols without touching the session)
//
// Exit codes:
//   0  ready (summary + contents printed)
//   1  no forge root found (the project needs `/forge init`)
//   2  usage / session-name error (remedy printed)
//   3  browser open failed (forge-pw output passed through)

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findForgeRoot } from './forge-common.mjs'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(SCRIPTS_DIR)

// macOS caps unix-socket paths at ~104 bytes; forge-pw's socket embeds the
// session name. Past this, `open` fails with `listen EINVAL`.
const SESSION_NAME_MAX = 16

function parseArgs(argv) {
  const opts = { session: null, headed: false, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--session') opts.session = argv[++i]
    else if (a.startsWith('--session=')) opts.session = a.slice('--session='.length)
    else if (a.startsWith('-s=')) opts.session = a.slice('-s='.length)
    else if (a === '--headed') opts.headed = true
    else if (a === '--no-open') opts.open = false
    else {
      console.error(`forge-preflight: unknown argument '${a}'`)
      process.exit(2)
    }
  }
  return opts
}

const readIfExists = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)

const countEntries = (dir) => {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.')).length
  } catch {
    return 0
  }
}

// Staleness nudge (mirrors the lead's old 1.3a): missing record on a sparse
// project → no nudge; missing on a non-sparse one, or a timestamp older than
// 7 days → nudge that scope.
function cleanupNudge(forgeRoot) {
  const NUDGE_AFTER_DAYS = 7
  const sparse = countEntries(join(forgeRoot, 'hints')) + countEntries(join(forgeRoot, 'snippets')) < 3
  let record = null
  try {
    record = JSON.parse(readFileSync(join(forgeRoot, '.last-cleanup'), 'utf8'))
  } catch {
    /* missing or unparsable → treated as never cleaned */
  }
  const daysSince = (iso) => {
    const t = Date.parse(iso)
    return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000)
  }
  const stale = (scope) => {
    const days = record?.[scope] ? daysSince(record[scope]) : null
    return days === null ? !sparse : days > NUDGE_AFTER_DAYS
  }
  const hints = stale('hints')
  const snippets = stale('snippets')
  return {
    nudge: hints && snippets ? 'both' : hints ? 'hints' : snippets ? 'snippets' : '',
    hintsDays: record?.hints ? daysSince(record.hints) : null,
    snippetsDays: record?.snippets ? daysSince(record.snippets) : null,
  }
}

// --- main ---
const opts = parseArgs(process.argv.slice(2))
if (!opts.session) {
  console.error('forge-preflight: usage: forge-preflight.mjs --session <name> [--headed] [--no-open]')
  process.exit(2)
}
if (opts.session.length > SESSION_NAME_MAX) {
  console.error(
    `forge-preflight: session name '${opts.session}' is ${opts.session.length} chars — ` +
      `the socket-path limit caps it at ${SESSION_NAME_MAX}. Shorten the name and retry.`
  )
  process.exit(2)
}

const forgeRoot = findForgeRoot(process.cwd())
if (!forgeRoot) {
  console.error(
    'forge-preflight: no forge/ directory found walking up from the current directory. ' +
      'The project needs `/forge init` first.'
  )
  process.exit(1)
}

const forgeMd = readIfExists(join(forgeRoot, 'hints', 'forge.md'))
const protocols = ['escalation.md', 'collaborativeness.md'].map((name) => ({
  name,
  content: readIfExists(join(PLUGIN_ROOT, 'protocols', name)),
}))

const headedSource = opts.headed ? 'flag' : process.env.FORGE_HEADED ? 'env' : 'default'
const headed = opts.headed || Boolean(process.env.FORGE_HEADED)

let browser = 'skipped'
let dashboard = 'skipped'
if (opts.open) {
  const pwArgs = [
    join(SCRIPTS_DIR, 'forge-pw.mjs'),
    `-s=${opts.session}`, 'open', '--browser=chrome',
    ...(headed ? ['--headed'] : []),
    'about:blank',
  ]
  const pw = spawnSync(process.execPath, pwArgs, { encoding: 'utf8' })
  if (pw.status !== 0) {
    process.stderr.write(pw.stderr || pw.stdout || '')
    console.error(`forge-preflight: browser open failed (session ${opts.session})`)
    process.exit(3)
  }
  browser = 'opened'
  if (!headed) {
    // Best-effort and idempotent — forge-dashboard no-ops when already up.
    spawnSync(process.execPath, [join(SCRIPTS_DIR, 'forge-dashboard.mjs')], { stdio: 'ignore' })
    dashboard = 'opened-or-already-running'
  }
}

// Detect OTHER forge installs (marketplace copy alongside a --plugin-dir dev
// copy, or vice versa). When two installs are loaded, teammate agent
// definitions can resolve to the other copy — a run silently mixes versions.
// Bounded walk of ~/.claude/plugins for .claude-plugin/plugin.json with
// name "forge" rooted somewhere other than this PLUGIN_ROOT.
function findOtherForgeInstalls() {
  const found = []
  const walk = (dir, depth) => {
    if (depth > 5 || found.length >= 16) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.git')) continue
      const child = join(dir, e.name)
      if (e.name === '.claude-plugin') {
        try {
          const manifest = JSON.parse(readFileSync(join(child, 'plugin.json'), 'utf8'))
          if (manifest.name === 'forge' && dir !== PLUGIN_ROOT) found.push(dir)
        } catch { /* not a manifest */ }
        continue
      }
      walk(child, depth + 1)
    }
  }
  walk(join(homedir(), '.claude', 'plugins'), 0)
  // The version cache accretes one dir per past version — collapse each
  // cache family to its newest entry so the signal is "another install
  // exists", not a version-history dump.
  const byFamily = new Map()
  for (const root of found) {
    const m = root.match(/^(.*\/cache\/[^/]+\/forge)\/[^/]+$/)
    const key = m ? m[1] : root
    const prev = byFamily.get(key)
    if (!prev || root > prev) byFamily.set(key, root)
  }
  return [...byFamily.values()]
}

// Teammate rendering is the harness's call (`teammateMode` in user settings):
// under `auto`, per-agent tmux panes appear only when this session itself runs
// inside tmux — otherwise teammates render inline. Report both inputs so the
// lead's banner can say where to watch instead of the mode differing silently.
let teammateMode = null
try {
  teammateMode = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')).teammateMode ?? null
} catch { /* unreadable settings — report null */ }

const cleanup = cleanupNudge(forgeRoot)
const summary = {
  forgeRoot,
  // The run's start time — threaded into the curator's spawn prompt as
  // RUN_STARTED_AT so forge-read-trace can exclude earlier drives that
  // share this parent session's teamName.
  startedAt: new Date().toISOString(),
  session: opts.session,
  headed,
  headedSource,
  browser,
  dashboard,
  insideTmux: Boolean(process.env.TMUX),
  teammateMode,
  pluginRoot: PLUGIN_ROOT,
  otherForgeInstalls: findOtherForgeInstalls(),
  hints: { forge: forgeMd !== null },
  setupSection: Boolean(forgeMd && /^##\s+Setup before each run\b/m.test(forgeMd)),
  teardownSection: Boolean(forgeMd && /^##\s+Teardown after each run\b/m.test(forgeMd)),
  cleanupNudge: cleanup.nudge,
  cleanupDays: { hints: cleanup.hintsDays, snippets: cleanup.snippetsDays },
}

console.log('# forge preflight: ok')
console.log(JSON.stringify(summary, null, 2))
console.log('')
console.log('## hints/forge.md')
console.log(forgeMd ?? '(absent — hints are optional; the scaffold drives correctly without them)')
for (const p of protocols) {
  console.log('')
  console.log(`## protocols/${p.name}`)
  console.log(p.content ?? `(missing from plugin install — read ${join(PLUGIN_ROOT, 'protocols', p.name)} manually)`)
}
