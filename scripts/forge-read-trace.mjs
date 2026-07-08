// forge-read-trace.mjs — the curator's reliable window into the
// driver's verbatim browser actions.
//
// Locates the driver's transcript by IDENTITY (its own agentName + teamName,
// not a substring mention — so it can't be fooled by the lead/curator
// transcripts that merely reference the same team), reads forward from a
// cursor, and prints the driver's forge-pw actions (the echoed Playwright +
// any returned value) plus a new cursor. Replaces the curator hand-rolling
// pwd-encoding + grep + jq + sleep.
//
// The transcript is the source of truth; this only ever READS it.
//
// Usage:
//   node forge-read-trace.mjs --team <TEAM> [--since <cursor>] [--await <sec>]
//                             [--driver <agentName>] [--project-dir <path>]
//                             [--started-after <ISO or epoch>]
//
// --started-after <t> — only consider transcripts still being written at (or
// started after) time t. Two sequential drives under one parent share a
// teamName, so identity alone can match an EARLIER drive's driver; passing
// this run's start time (the lead threads preflight's `startedAt` through
// the curator's spawn prompt) excludes finished predecessors. When multiple
// transcripts still match, the newest is used and a warning names the others.
// If the expected project dir has no match (the driver may run under a
// different cwd), other project dirs are scanned as a fallback — bounded to
// recently-written files.
//
// Prints readable blocks the curator authors from, then a trailing
// `cursor: <N>` line to pass as the next --since. Result-less trailing
// actions (transcript not yet flushed) are left for the next read.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def
}

const team = opt('--team')
const since = parseInt(opt('--since', '0'), 10) || 0
const awaitSec = parseInt(opt('--await', '0'), 10) || 0
const driver = opt('--driver', 'driver')
const projectDir = opt(
  '--project-dir',
  join(homedir(), '.claude', 'projects', process.cwd().replace(/\//g, '-')),
)
const startedAfterRaw = opt('--started-after', null)

if (!team) {
  console.error('forge-read-trace: --team <TEAM_NAME> is required')
  process.exit(2)
}

function parseTime(raw) {
  if (raw == null) return null
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    return n < 1e12 ? n * 1000 : n // epoch seconds vs ms
  }
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}
const startedAfterMs = parseTime(startedAfterRaw)
if (startedAfterRaw != null && startedAfterMs == null) {
  console.error(`forge-read-trace: --started-after: cannot parse '${startedAfterRaw}' (ISO 8601 or epoch)`)
  process.exit(2)
}

// First record timestamp — when the transcript's session began.
function firstRecordTime(text) {
  const m = text.slice(0, 4096).match(/"timestamp":"([^"]+)"/)
  return m ? Date.parse(m[1]) : null
}

// Collect transcripts in `dir` whose OWN records carry agentName===driver &&
// teamName===team, still live at/after startedAfterMs (when given).
function collectMatches(dir, recentFloorMs) {
  const matches = []
  let entries
  try {
    entries = readdirSync(dir) // ENOENT/ENOTDIR (.DS_Store in projects/) → no matches
  } catch {
    return matches
  }
  for (const f of entries) {
    if (!f.endsWith('.jsonl')) continue
    const path = join(dir, f)
    let mtime
    try {
      mtime = statSync(path).mtimeMs
    } catch {
      continue
    }
    // A transcript whose last write predates the run can't be this run's
    // driver — skip before the (expensive) full read.
    if (recentFloorMs && mtime < recentFloorMs) continue
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    // cheap prefilter, then confirm on a real record's identity fields
    if (!text.includes(`"teamName":"${team}"`) || !text.includes(`"agentName":"${driver}"`)) continue
    let isDriver = false
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let rec
      try {
        rec = JSON.parse(line)
      } catch {
        continue
      }
      if (rec.agentName === driver && rec.teamName === team) {
        isDriver = true
        break
      }
    }
    if (!isDriver) continue
    if (startedAfterMs) {
      const t0 = firstRecordTime(text)
      if (t0 && t0 < startedAfterMs) continue // an earlier drive's driver
    }
    matches.push({ path, mtime })
  }
  return matches
}

let notedFallback = false
let warnedAmbiguous = false
function locate() {
  let matches = collectMatches(projectDir, startedAfterMs)
  let viaFallback = false
  if (matches.length === 0) {
    // The driver may run under a different cwd than expected (its transcript
    // lands in that cwd's encoded project dir). Fall back to scanning the
    // other project dirs — bounded to files written since the run started
    // (or the last 24h when no --started-after was given).
    const floor = startedAfterMs ?? Date.now() - 24 * 3600 * 1000
    const projectsRoot = join(homedir(), '.claude', 'projects')
    if (existsSync(projectsRoot)) {
      for (const d of readdirSync(projectsRoot)) {
        const dir = join(projectsRoot, d)
        if (dir === projectDir) continue
        matches = matches.concat(collectMatches(dir, floor))
      }
      viaFallback = matches.length > 0
    }
  }
  if (matches.length === 0) return null
  matches.sort((a, b) => b.mtime - a.mtime)
  if (viaFallback && !notedFallback) {
    notedFallback = true
    console.log(`# note: driver transcript found outside --project-dir (${basename(projectDir)}) — using ${matches[0].path}`)
  }
  if (matches.length > 1 && !warnedAmbiguous) {
    warnedAmbiguous = true
    console.log(
      `# WARNING: ${matches.length} transcripts match driver identity (team ${team}) — using newest ` +
        `${basename(matches[0].path)}; also matched: ${matches.slice(1).map((m) => basename(m.path)).join(', ')}. ` +
        `Pass --started-after <run start> to exclude earlier drives.`,
    )
  }
  return matches[0].path
}

// Build { actions, results } from transcript lines.
function parse(lines) {
  const results = new Map() // tool_use_id -> result text
  const actions = [] // { idx, command, id }
  lines.forEach((line, idx) => {
    if (!line.trim()) return
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      return
    }
    const content = rec?.message?.content
    if (!Array.isArray(content)) return
    for (const c of content) {
      if (c?.type === 'tool_use' && c?.name === 'Bash') {
        const cmd = c.input?.command || ''
        // Match both invocation forms: the forge-cli front door (0.45+,
        // `forge-cli.mjs pw` / `forge-cli.mjs invoke-snippet`) and the
        // standalone scripts (`forge-pw.mjs` / `forge-invoke-snippet.mjs`).
        if (/forge-pw\.mjs|forge-invoke-snippet\.mjs|forge-cli\.mjs\s+(?:--?\S+\s+)*(?:pw|invoke-snippet)\b/.test(cmd)) {
          actions.push({ idx, command: cmd, id: c.id })
        }
      } else if (c?.type === 'tool_result' && c?.tool_use_id) {
        const txt = Array.isArray(c.content)
          ? c.content.map((p) => p.text || '').join('')
          : typeof c.content === 'string'
            ? c.content
            : ''
        results.set(c.tool_use_id, txt)
      }
    }
  })
  return { actions, results }
}

function extractEcho(text) {
  const i = text.indexOf('### Ran Playwright code')
  if (i < 0) return null
  const fence = text.slice(i).match(/```(?:js|javascript)?\n([\s\S]*?)```/)
  return fence ? fence[1].trim() : null
}

function extractReturned(text) {
  const m = text.match(/\{\s*"(?:result|isError)"[\s\S]*\}/)
  return m ? m[0].replace(/\s+/g, ' ').trim().slice(0, 300) : null
}

function runCodeBody(cmd) {
  // No end-anchor: the driver appends flags (e.g. `--json`) after the body, so
  // the closing quote isn't at end-of-command. Greedy `[\s\S]*` still lands on
  // the true closing quote — trailing flags carry no quote of their own.
  const m = cmd.match(/run-code\s+(['"])([\s\S]*)\1/)
  return m ? m[2] : null
}

function format(a, results) {
  const cmd = a.command
  const res = results.get(a.id) || ''
  // The driver may wrap a command across lines with `\`-continuations. A
  // `\`<newline> isn't whitespace, so it defeats the verb / run-code-body /
  // snippet regexes below — silently dropping the echoed code (a run-code body
  // renders as `—`). Collapse each continuation to a single space so matching
  // sees one flat command regardless of how the driver formatted it.
  const normCmd = cmd.replace(/\s*\\\n\s*/g, ' ')
  if (/forge-invoke-snippet\.mjs|forge-cli\.mjs\s+(?:--?\S+\s+)*invoke-snippet\b/.test(normCmd)) {
    const m = normCmd.match(/--snippet\s+\S*\/([\w-]+)\.ts/)
    return `── invoked snippet ──\n  ${m ? m[1] : '(unknown)'}  (reuse — not new authoring)`
  }
  // Verb = the first bare word after -s=<session>, in either invocation form
  // (flags like --json may sit between the entry point and -s).
  const vm = normCmd.match(/(?:forge-pw\.mjs|forge-cli\.mjs\s+(?:--?\S+\s+)*pw)\s+(?:--?\S+\s+)*-s=\S+\s+([\w-]+)/)
  const verb = vm ? vm[1] : '(?)'
  if (verb === 'snapshot' || verb === 'open') {
    return `── ${verb} ──  (orientation — no snippet code)`
  }
  const echo = extractEcho(res) || (verb === 'run-code' ? runCodeBody(normCmd) : null)
  const returned = extractReturned(res)
  let block = `── drove fresh: ${verb === 'run-code' ? 'run-code' : `forge-pw ${verb}`} ──\n`
  block += `  playwright:\n${echo ? echo.split('\n').map((l) => '    ' + l).join('\n') : '    —'}`
  if (returned) block += `\n  returned: ${returned}`
  return block
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const deadline = Date.now() + awaitSec * 1000
  for (;;) {
    const path = locate()
    if (path) {
      const lines = readFileSync(path, 'utf8').split('\n')
      const { actions, results } = parse(lines)
      const fresh = actions.filter((a) => a.idx >= since)
      // Stop the cursor before the first action whose result hasn't flushed,
      // so a result-less trailing action is re-read (never skipped).
      const firstMissing = fresh.find((a) => !results.has(a.id))
      const ready = firstMissing ? fresh.filter((a) => a.idx < firstMissing.idx) : fresh
      // A non-empty, unparseable final line is a torn write mid-flush — hold
      // the cursor before it so the completed line is re-read next time
      // (parse() skipped it, so advancing past it would drop the action).
      let flushedEnd = lines.length
      const lastLine = lines[lines.length - 1]
      if (lastLine && lastLine.trim()) {
        try {
          JSON.parse(lastLine)
        } catch {
          flushedEnd = lines.length - 1
        }
      }
      const cursor = firstMissing ? firstMissing.idx : flushedEnd
      if (ready.length > 0 || Date.now() >= deadline) {
        const blocks = ready.map((a) => format(a, results))
        console.log(
          `# ${driver} trace — team ${team} — lines ${since}..${cursor} (${blocks.length} new action${blocks.length === 1 ? '' : 's'})`,
        )
        console.log('')
        if (blocks.length) console.log(blocks.join('\n\n') + '\n')
        console.log(`cursor: ${cursor}`)
        return
      }
    } else if (Date.now() >= deadline) {
      console.log(`# ${driver} transcript not found yet (team ${team}) — retry on next signal`)
      console.log(`cursor: ${since}`)
      return
    }
    await sleep(1000)
  }
}

main()
