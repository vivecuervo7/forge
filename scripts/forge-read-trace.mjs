// forge-read-trace.mjs — the snippet-curator's reliable window into the
// driver-worker's verbatim browser actions.
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
//
// Prints readable blocks the curator authors from, then a trailing
// `cursor: <N>` line to pass as the next --since. Result-less trailing
// actions (transcript not yet flushed) are left for the next read.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def
}

const team = opt('--team')
const since = parseInt(opt('--since', '0'), 10) || 0
const awaitSec = parseInt(opt('--await', '0'), 10) || 0
const driver = opt('--driver', 'driver-worker')
const projectDir = opt(
  '--project-dir',
  join(homedir(), '.claude', 'projects', process.cwd().replace(/\//g, '-')),
)

if (!team) {
  console.error('forge-read-trace: --team <TEAM_NAME> is required')
  process.exit(2)
}

// Find the transcript whose OWN records carry agentName===driver && teamName===team.
function locate() {
  if (!existsSync(projectDir)) return null
  let best = null
  let bestMtime = 0
  for (const f of readdirSync(projectDir)) {
    if (!f.endsWith('.jsonl')) continue
    const path = join(projectDir, f)
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
    const m = statSync(path).mtimeMs
    if (m > bestMtime) {
      bestMtime = m
      best = path
    }
  }
  return best
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
        if (cmd.includes('forge-pw.mjs') || cmd.includes('forge-invoke-snippet.mjs')) {
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
  const m = cmd.match(/run-code\s+(['"])([\s\S]*)\1\s*$/)
  return m ? m[2] : null
}

function format(a, results) {
  const cmd = a.command
  const res = results.get(a.id) || ''
  if (cmd.includes('forge-invoke-snippet.mjs')) {
    const m = cmd.match(/--snippet\s+\S*\/([\w-]+)\.ts/)
    return `── invoked snippet ──\n  ${m ? m[1] : '(unknown)'}  (reuse — not new authoring)`
  }
  const vm = cmd.match(/forge-pw\.mjs\s+-s=\S+\s+([\w-]+)/)
  const verb = vm ? vm[1] : '(?)'
  if (verb === 'snapshot' || verb === 'open') {
    return `── ${verb} ──  (orientation — no snippet code)`
  }
  const echo = extractEcho(res) || (verb === 'run-code' ? runCodeBody(cmd) : null)
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
      const cursor = firstMissing ? firstMissing.idx : lines.length
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
