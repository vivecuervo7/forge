#!/usr/bin/env node
// forge-cli.test.mjs — dispatch matrix for the forge-cli entry point.
// Unit-tests verb resolution/listing via import, then spawns the real CLI
// (as callers do) for the end-to-end contract: argv rewrite, verb execution,
// exit-code propagation, usage on unknown verb.
//
// Run: node scripts/forge-cli.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listVerbs, resolveVerb, verbDescription } from './forge-cli.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'forge-cli.mjs')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- unit: verb listing / resolution -----------------------------------

const verbs = listVerbs()
for (const expected of ['pw', 'observe', 'find-root', 'run-spec', 'read-trace', 'snippet-index']) {
  check(`lists '${expected}'`, verbs.includes(expected), `got: ${verbs.join(', ')}`)
}
check("excludes 'common' (library, not a verb)", !verbs.includes('common'))
check("excludes 'cli' (itself)", !verbs.includes('cli'))

check("resolves 'pw' to its script", resolveVerb('pw')?.endsWith('forge-pw.mjs') === true)
check("rejects unknown verb", resolveVerb('does-not-exist') === null)
check("rejects 'common'", resolveVerb('common') === null)
check("rejects path-shaped input", resolveVerb('../hooks/guard') === null)
check("rejects empty verb", resolveVerb('') === null)

check(
  "reads pw's description from its header",
  verbDescription('pw').includes('wrapper'),
  `got: '${verbDescription('pw')}'`
)

// --- e2e: spawn the CLI as callers do -----------------------------------

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts })
}

// No verb → usage on stderr, exit 2, lists the verbs.
{
  const r = run([])
  check('no verb exits 2', r.status === 2, `status ${r.status}`)
  check('no verb prints usage', r.stderr.includes('usage:') && r.stderr.includes('find-root'))
}

// Unknown verb → named in the error, exit 2.
{
  const r = run(['frobnicate'])
  check('unknown verb exits 2', r.status === 2, `status ${r.status}`)
  check('unknown verb is named', r.stderr.includes("unknown verb 'frobnicate'"))
}

// Real verb, argv rewrite: find-root inside a scaffolded forge dir finds it;
// outside one it exits non-zero — both behaviors identical to direct invocation.
{
  const root = mkdtempSync(join(tmpdir(), 'forge-cli-test-'))
  try {
    mkdirSync(join(root, 'proj', 'forge', 'hints'), { recursive: true })
    const inside = run(['find-root'], { cwd: join(root, 'proj') })
    check('find-root succeeds inside a project', inside.status === 0, inside.stderr)
    check('find-root prints the forge dir', inside.stdout.trim().endsWith(join('proj', 'forge')))

    const direct = spawnSync(
      process.execPath,
      [join(dirname(CLI), 'forge-find-root.mjs')],
      { encoding: 'utf8', cwd: join(root, 'proj') }
    )
    check('dispatched output matches direct invocation', inside.stdout === direct.stdout)

    const outside = run(['find-root'], { cwd: root })
    check('find-root fails outside a project', outside.status !== 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-cli: all dispatch cases pass')
