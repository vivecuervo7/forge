#!/usr/bin/env node
// forge-cli.mjs — the single entry point for forge's scripts.
//
// One dispatcher, many verbs: `forge-cli.mjs <verb> [args...]` resolves the
// verb to its sibling `forge-<verb>.mjs` script and runs it in-process (argv
// rewritten so the verb script parses its args exactly as if invoked
// directly). The per-verb scripts keep working standalone — this adds the
// canonical front door without moving anything.
//
// Why a front door:
//   - Callers (agent prompts, hint files, users) reference ONE path and a
//     verb, so verbs can migrate from standalone scripts to imported modules
//     without any caller changing.
//   - One place for usage/discovery: `forge-cli.mjs` with no verb lists every
//     verb with its one-line description (read from each script's header).
//   - The seam for the eventual extracted forge-cli: today's verb names are
//     tomorrow's CLI surface.
//
// Dispatch is in-process (dynamic import after an argv rewrite), not a child
// spawn — no extra process, and the verb script's own process.exit /
// event-loop lifetime behave exactly as when run directly.
//
// Usage:
//   forge-cli.mjs <verb> [args...]     # e.g. forge-cli.mjs pw -s=demo open about:blank
//   forge-cli.mjs                      # list verbs
//
// Exit codes:
//   propagated from the verb script, except:
//   2   unknown / missing verb (usage printed)

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

// Library files that live in scripts/ but are not runnable verbs.
const NON_VERBS = new Set(['common', 'cli'])

export function listVerbs(dir = SCRIPTS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^forge-[a-z][a-z-]*\.mjs$/.test(f) && !f.endsWith('.test.mjs'))
    .map((f) => f.slice('forge-'.length, -'.mjs'.length))
    .filter((v) => !NON_VERBS.has(v))
    .sort()
}

// A verb's one-liner is its script's header comment (joining wrapped
// continuation lines up to the first sentence end):
//   // forge-<verb>.mjs — <description...>
export function verbDescription(verb, dir = SCRIPTS_DIR) {
  try {
    const head = readFileSync(join(dir, `forge-${verb}.mjs`), 'utf8').split('\n', 8)
    for (let i = 0; i < head.length; i++) {
      const m = head[i].match(/^\/\/ forge-[a-z-]+\.mjs — (.+)$/)
      if (!m) continue
      let desc = m[1].trim()
      while (!/\.(\s|$)/.test(desc) && i + 1 < head.length) {
        const cont = head[++i].match(/^\/\/ (\S.*)$/)
        if (!cont) break
        desc += ` ${cont[1].trim()}`
      }
      return desc.split(/(?<=\.)\s/)[0].replace(/\.$/, '')
    }
  } catch {
    /* fall through */
  }
  return ''
}

export function resolveVerb(verb, dir = SCRIPTS_DIR) {
  if (!verb || !/^[a-z][a-z-]*$/.test(verb) || NON_VERBS.has(verb)) return null
  return listVerbs(dir).includes(verb) ? join(dir, `forge-${verb}.mjs`) : null
}

function printUsage() {
  console.error('usage: forge-cli.mjs <verb> [args...]')
  console.error('')
  console.error('verbs:')
  for (const verb of listVerbs()) {
    const desc = verbDescription(verb)
    console.error(`  ${verb.padEnd(16)}${desc}`)
  }
}

async function main() {
  const verb = process.argv[2]
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    printUsage()
    process.exit(2)
  }
  const scriptPath = resolveVerb(verb)
  if (!scriptPath) {
    console.error(`forge-cli: unknown verb '${verb}'`)
    printUsage()
    process.exit(2)
  }
  // Rewrite argv so the verb script sees itself as directly invoked:
  // process.argv.slice(2) inside it yields the args after the verb.
  process.argv = [process.argv[0], scriptPath, ...process.argv.slice(3)]
  await import(pathToFileURL(scriptPath))
}

// Run only as the entry point — importable for tests without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`forge-cli: ${err?.message ?? err}`)
    process.exit(1)
  })
}
