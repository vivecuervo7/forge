#!/usr/bin/env node
// forge-read-trace.test.mjs — disambiguation matrix for the trace reader.
// Two sequential drives under one parent share a teamName, so driver-identity
// matching alone can land on the EARLIER drive's transcript. These cases pin
// the fix: --started-after excludes finished predecessors; multiple surviving
// matches warn and pick the newest.
//
// Run: node scripts/forge-read-trace.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'forge-read-trace.mjs')
const TEAM = 'session-fixture'

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}

// A minimal driver transcript: one browser action + its flushed result, in
// either invocation form — 'old' = standalone forge-pw.mjs, 'new' = the
// forge-cli front door (0.45+). The 'new' form also carries an
// invoke-snippet action so the front-door filter is pinned for both verbs.
function transcript(startedIso, ref, form = 'old') {
  const identity = { timestamp: startedIso, agentName: 'driver', teamName: TEAM }
  const pwCmd =
    form === 'new'
      ? `node /plugin/scripts/forge-cli.mjs pw --json -s=fx click ${ref}`
      : `node /plugin/scripts/forge-pw.mjs -s=fx click ${ref}`
  const records = [
    {
      ...identity,
      message: {
        content: [{ type: 'tool_use', name: 'Bash', id: `tool-${ref}`, input: { command: pwCmd } }],
      },
    },
    {
      ...identity,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: `tool-${ref}`,
            content: `### Ran Playwright code\n\`\`\`js\nawait page.click('${ref}')\n\`\`\``,
          },
        ],
      },
    },
  ]
  if (form === 'new') {
    records.push(
      {
        ...identity,
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              id: `tool-${ref}-inv`,
              input: {
                command: `node /plugin/scripts/forge-cli.mjs invoke-snippet -s=fx --snippet /proj/forge/snippets/add-item-to-cart.ts --args '{}' --json`,
              },
            },
          ],
        },
      },
      {
        ...identity,
        message: {
          content: [
            { type: 'tool_result', tool_use_id: `tool-${ref}-inv`, content: `{"result": "ok"}` },
          ],
        },
      },
    )
  }
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

function run(dir, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [SCRIPT, '--team', TEAM, '--project-dir', dir, ...extraArgs],
    { encoding: 'utf8' },
  )
}

const dir = mkdtempSync(join(tmpdir(), 'forge-read-trace-test-'))
try {
  // All times derive from the real clock — the mtime floor compares against
  // Date.now(), so hard-coded dates would drift with the wall clock.
  const now = Date.now()
  const iso = (ms) => new Date(ms).toISOString()
  const driveAStart = now - 4 * 3600 * 1000 // finished drive, 4h ago
  const driveBStart = now - 30 * 60 * 1000 // this run's drive, 30m ago
  const boundary = now - 2 * 3600 * 1000 // run start: between the two

  // Drive A: started 4h ago, finished long ago (old mtime).
  // Drive B: started 30m ago, still live (fresh mtime).
  const oldPath = join(dir, 'aaaa-drive-a.jsonl')
  const newPath = join(dir, 'bbbb-drive-b.jsonl')
  writeFileSync(oldPath, transcript(iso(driveAStart), 'eOLD', 'old'))
  writeFileSync(newPath, transcript(iso(driveBStart), 'eNEW', 'new'))
  const past = (now - 3 * 3600 * 1000) / 1000
  utimesSync(oldPath, past, past)

  // No --started-after: both match → warn, pick newest mtime (drive B).
  {
    const r = run(dir)
    check('ambiguous: warns', r.stdout.includes('# WARNING: 2 transcripts match'), r.stdout)
    check('ambiguous: names the loser', r.stdout.includes('aaaa-drive-a.jsonl'))
    check('ambiguous: picks the newest', r.stdout.includes("click('eNEW')"))
    check('ambiguous: suggests the remedy', r.stdout.includes('--started-after'))
  }

  // --started-after between the drives: drive A excluded → no warning.
  // Drive B uses the forge-cli front door, so this also pins the 0.45+
  // invocation forms: the pw action's echo AND the invoke-snippet action.
  {
    const r = run(dir, ['--started-after', iso(boundary)])
    check('filtered: no warning', !r.stdout.includes('# WARNING'), r.stdout)
    check('filtered: reads drive B (front-door pw form)', r.stdout.includes("click('eNEW')"), r.stdout)
    check('filtered: front-door invoke-snippet recognized', r.stdout.includes('invoked snippet') && r.stdout.includes('add-item-to-cart'))
    check('filtered: drive A absent', !r.stdout.includes("click('eOLD')"))
  }

  // --started-after past both: nothing matches → not-found, cursor preserved.
  {
    const r = run(dir, ['--started-after', iso(now + 3600 * 1000), '--since', '7'])
    check('none: reports not-found', r.stdout.includes('transcript not found yet'), r.stdout)
    check('none: cursor preserved', r.stdout.includes('cursor: 7'))
  }

  // Epoch-seconds form parses too.
  {
    const r = run(dir, ['--started-after', String(Math.floor(boundary / 1000))])
    check('epoch form: reads drive B', r.stdout.includes("click('eNEW')"), r.stdout)
  }

  // Garbage time errors out with usage guidance.
  {
    const r = run(dir, ['--started-after', 'yesterdayish'])
    check('bad time: exits 2', r.status === 2, `status ${r.status}`)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-read-trace: all disambiguation cases pass')
