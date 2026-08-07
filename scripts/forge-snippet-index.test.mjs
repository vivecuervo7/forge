#!/usr/bin/env node
// forge-snippet-index.test.mjs — the flow-sliced index.
//
// The driver reads the library on every drive. Reading it whole costs the context
// of every flow the task will never touch, so the generator also emits a small
// orientation file plus one slice per flow, and the driver reads only what it
// needs. The properties that matter: INDEX.md keeps its existing shape, the
// slices account for every snippet exactly once, a stale slice cannot linger, and
// two flow names that reduce to the same filename cannot overwrite each other.
//
// Run: node scripts/forge-snippet-index.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flowSlug } from './lib/snippet-index.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'forge-cli.mjs')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}

function library(snippets) {
  const root = mkdtempSync(join(tmpdir(), 'forge-idx-'))
  mkdirSync(join(root, 'forge', 'hints'), { recursive: true })
  const dir = join(root, 'forge', 'snippets')
  mkdirSync(dir, { recursive: true })
  for (const [name, meta] of Object.entries(snippets)) writeSnippet(dir, name, meta)
  return { root: join(root, 'forge'), dir }
}
function writeSnippet(dir, name, meta) {
  writeFileSync(join(dir, `${name}.ts`),
    `export const meta = ${JSON.stringify(meta, null, 2)}\nexport async function run(page, args) {}\n`)
}
const gen = (root) => spawnSync('node', [CLI, 'snippet-index', root], { encoding: 'utf8' })
const entriesIn = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim().startsWith('- '))
const slicesIn = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'FLOWS.md')

// --- slug ---------------------------------------------------------------

check('slug lowercases and hyphenates', flowSlug('Billing Address') === 'billing-address', flowSlug('Billing Address'))
check('slug survives arrows and slashes', flowSlug('cart→payment/step') === 'cart-payment-step', flowSlug('cart→payment/step'))
check('slug of an unnamed flow is misc', flowSlug('') === 'misc')
check('slug of symbols alone is misc', flowSlug('→→') === 'misc', flowSlug('→→'))

// --- every snippet appears once, and the two views agree ----------------

{
  const { root, dir } = library({
    'open-cart': { description: 'Opens the cart.', args: {}, flow: 'checkout' },
    'pay-now': { description: 'Pays.', args: { card: {} }, flow: 'checkout' },
    'search-things': { description: 'Searches.', args: { q: {} }, flow: 'browse' },
    'no-flow-here': { description: 'Ungrouped.', args: {} },
  })
  const r = gen(root)
  check('generator exits 0', r.status === 0, r.stderr)

  check('INDEX.md still lists everything', entriesIn(join(dir, 'INDEX.md')).length === 4)

  const idxDir = join(dir, 'index')
  const slices = slicesIn(idxDir)
  check('one slice per flow, misc included', slices.length === 3, slices.join(','))
  check('slices account for every snippet once',
    slices.flatMap((f) => entriesIn(join(idxDir, f))).length === 4)

  const toc = readFileSync(join(idxDir, 'FLOWS.md'), 'utf8')
  check('FLOWS.md names every flow',
    toc.includes('flow: checkout') && toc.includes('flow: browse') && toc.includes('flow: misc'))
  check('FLOWS.md lists snippet names', toc.includes('open-cart') && toc.includes('pay-now'))
  check('FLOWS.md points at the slices', toc.includes('snippets/index/checkout.md'))
  // Orientation must stay cheap: names only, no descriptions.
  check('FLOWS.md omits descriptions', !toc.includes('Opens the cart'))
  check('a slice carries the descriptions',
    readFileSync(join(idxDir, 'checkout.md'), 'utf8').includes('Opens the cart'))
  check('a slice carries args and preconditions shape', entriesIn(join(idxDir, 'checkout.md')).some((l) => l.includes('pay-now(card)')))
}

// --- a removed flow must not leave a slice behind -----------------------

{
  const { root, dir } = library({
    'a-thing': { description: 'A.', args: {}, flow: 'alpha' },
    'b-thing': { description: 'B.', args: {}, flow: 'beta' },
  })
  gen(root)
  check('both slices present initially', existsSync(join(dir, 'index', 'beta.md')))
  // Re-home the snippet, leaving `beta` empty.
  writeSnippet(dir, 'b-thing', { description: 'B.', args: {}, flow: 'alpha' })
  gen(root)
  check('the emptied flow leaves no stale slice', !existsSync(join(dir, 'index', 'beta.md')),
    'a stale slice would offer the driver snippets that moved or vanished')
  check('the surviving flow holds both', entriesIn(join(dir, 'index', 'alpha.md')).length === 2)
}

// --- flow names colliding on disk keep both sets ------------------------

{
  const { root, dir } = library({
    'one-thing': { description: 'One.', args: {}, flow: 'cart payment' },
    'two-thing': { description: 'Two.', args: {}, flow: 'cart→payment' },
  })
  gen(root)
  const idxDir = join(dir, 'index')
  const slices = slicesIn(idxDir)
  check('colliding flow names get separate files', slices.length === 2, slices.join(','))
  check('neither snippet is lost to the collision',
    slices.flatMap((f) => entriesIn(join(idxDir, f))).length === 2)
}

// --- no snippets at all -------------------------------------------------

{
  const { root, dir } = library({})
  const r = gen(root)
  check('an empty library still exits 0', r.status === 0, r.stderr)
  check('an empty library still gets a FLOWS.md', existsSync(join(dir, 'index', 'FLOWS.md')))
}

// --- idempotent ---------------------------------------------------------

{
  const { root, dir } = library({ 'x-thing': { description: 'X.', args: {}, flow: 'f' } })
  gen(root)
  const first = readFileSync(join(dir, 'INDEX.md'), 'utf8')
  const firstToc = readFileSync(join(dir, 'index', 'FLOWS.md'), 'utf8')
  gen(root)
  check('INDEX.md is idempotent', readFileSync(join(dir, 'INDEX.md'), 'utf8') === first)
  check('FLOWS.md is idempotent', readFileSync(join(dir, 'index', 'FLOWS.md'), 'utf8') === firstToc)
}

if (failures > 0) {
  console.error(`\nforge-snippet-index: ${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-snippet-index: all cases pass')
