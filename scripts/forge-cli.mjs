#!/usr/bin/env node
// forge-cli.mjs — THE entry point for forge's scripts.
//
// One dispatcher, many verbs: `forge-cli.mjs <verb> [args...]` imports the
// verb's module from `scripts/lib/<verb>.mjs` and calls its exported
// `main(args)`. The lib modules are pure — no top-level execution — so this
// front door is the only runnable surface; running a lib file directly is a
// no-op. Every caller (agent prompts, hint files, users, and the verbs'
// own internal cross-calls) goes through here, so there is exactly one
// invocation grammar to read, guard, and parse from transcripts.
//
// Usage:
//   forge-cli.mjs <verb> [args...]     # e.g. forge-cli.mjs pw -s=demo open about:blank
//   forge-cli.mjs                      # list verbs
//
// Exit codes:
//   propagated from the verb (verbs call process.exit), except:
//   2   unknown / missing verb (usage printed)

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'lib')

// Library files that hold shared helpers rather than a runnable verb.
const NON_VERBS = new Set(['common'])

export function listVerbs(dir = LIB_DIR) {
  return readdirSync(dir)
    .filter((f) => /^[a-z][a-z-]*\.mjs$/.test(f) && !f.endsWith('.test.mjs'))
    .map((f) => f.slice(0, -'.mjs'.length))
    .filter((v) => !NON_VERBS.has(v))
    .sort()
}

// A verb's one-liner is its module's header comment (joining wrapped
// continuation lines up to the first sentence end):
//   // <verb> — <description...>
export function verbDescription(verb, dir = LIB_DIR) {
  try {
    const head = readFileSync(join(dir, `${verb}.mjs`), 'utf8').split('\n', 8)
    for (let i = 0; i < head.length; i++) {
      const m = head[i].match(/^\/\/ [a-z-]+ — (.+)$/)
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

export function resolveVerb(verb, dir = LIB_DIR) {
  if (!verb || !/^[a-z][a-z-]*$/.test(verb) || NON_VERBS.has(verb)) return null
  return listVerbs(dir).includes(verb) ? join(dir, `${verb}.mjs`) : null
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

async function dispatch() {
  const verb = process.argv[2]
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    printUsage()
    process.exit(2)
  }
  const modulePath = resolveVerb(verb)
  if (!modulePath) {
    console.error(`forge-cli: unknown verb '${verb}'`)
    printUsage()
    process.exit(2)
  }
  const mod = await import(pathToFileURL(modulePath))
  if (typeof mod.main !== 'function') {
    console.error(`forge-cli: verb '${verb}' has no main() — broken install`)
    process.exit(2)
  }
  await mod.main(process.argv.slice(3))
}

// Run only as the entry point — importable for tests without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dispatch().catch((err) => {
    console.error(`forge-cli: ${err?.message ?? err}`)
    process.exit(1)
  })
}
