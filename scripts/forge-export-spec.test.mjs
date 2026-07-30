#!/usr/bin/env node
// forge-export-spec.test.mjs — the composed-spec → self-contained-spec matrix.
//
// exportSpec is a pure text transform over an injected module loader, so the
// matrix is unit-tested by import with no filesystem involved. Three things
// get pinned beyond "the text looks right":
//
//   - The generated code is EXECUTED (§ execution) against a stub page, so
//     module wrapping, dependency injection and definition order are proven
//     to run rather than merely to parse. This is the check that catches a
//     spec which loads but silently does nothing.
//   - The spec body is asserted byte-identical, since the whole design goal
//     is that call sites and assertions survive untouched.
//   - The verb's exit-code contract is pinned end-to-end through the real CLI.
//
// Run: node scripts/forge-export-spec.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSpec, parseImportClause, fixtureNames, analyseModule } from './lib/export-spec.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'forge-cli.mjs')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}

const libOf = (snippets) => (name) => snippets[name] ?? null
const run = (specText, snippets, opts = {}) =>
  exportSpec({ specText, loadModule: libOf(snippets), date: '2025-01-01', ...opts })

const caught = (fn) => {
  try {
    fn()
    return null
  } catch (err) {
    return err
  }
}

// --- fixture library ------------------------------------------------------
// Runtime-executable (no type annotations) so § execution can evaluate the
// generated file. Drawn from the plugin's sample-site vocabulary.

const SNIPPETS = {
  '_escape-regex': `// Shared helper — not a standalone snippet.
export const meta = {
  description: 'Escapes regex metacharacters.',
  args: { str: { type: 'string' } },
  tags: ['helper'],
}

export function escapeRegex(str) {
  return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
}
`,

  // The delegating-run shape: the implementation lives in a sibling export and
  // `run` is a one-line alias. Splicing only run's body drops the sibling and
  // returns out of the caller.
  login: `export const meta = { description: 'Log in.', args: {}, tags: ['auth'] }

export async function login(page, args) {
  page.calls.push('login:' + args.username)
  return 'logged-in'
}

export async function run(page, args) {
  return login(page, args)
}
`,

  // Depends on a sibling snippet — only reachable transitively.
  'add-item-to-cart': `import { escapeRegex } from './_escape-regex'

export const meta = { description: 'Add an item to the cart.', args: {}, tags: ['cart'] }

const ADD_BUTTON = 'button.add-to-cart'

export async function run(page, args) {
  page.calls.push('add:' + escapeRegex(args.item) + ':' + ADD_BUTTON)
  return { added: args.item }
}
`,

  // Two hops deep, and calls its dependency through a `run as` alias.
  checkout: `import { run as addItemToCart } from './add-item-to-cart'

export const meta = { description: 'Check out.', args: {}, tags: ['cart'] }

export async function run(page, args) {
  await addItemToCart(page, { item: args.item })
  page.calls.push('checkout')
  return { ok: true }
}
`,
}

// --- namespace import form ------------------------------------------------

{
  const spec = `import { test, expect } from '@playwright/test'
import * as login from '../snippets/login'

test('flow', async ({ page }) => {
  await login.run(page, { username: 'standard_user' })
})
`
  const r = run(spec, SNIPPETS)
  check('namespace: module inlined', r.modules.includes('login'))
  check('namespace: binding emitted', /^const login = \$login$/m.test(r.text))
  check(
    'namespace: sibling export survives alongside run',
    /return \{ login, run \}/.test(r.text),
    'the delegating run() needs its sibling in scope'
  )
  check('namespace: no snippet path survives', !/from '\.\.\/snippets\//.test(r.text))
  check(
    'namespace: no bare return spliced into the test',
    !/^\s+return login\(page, args\)$/m.test(r.text.split("test('flow'")[1] ?? '')
  )
}

// --- named `run as` import form (the form that was entirely unsupported) ---

{
  const spec = `import { test, expect } from '@playwright/test'
import { run as addItemToCart } from '../snippets/add-item-to-cart'

test('flow', async ({ page }) => {
  await addItemToCart(page, { item: 'sauce-labs-backpack' })
})
`
  const r = run(spec, SNIPPETS)
  check('run-as: module inlined', r.modules.includes('add-item-to-cart'))
  check(
    'run-as: binding destructures run',
    /const \{ run: addItemToCart \} = \$addItemToCart/.test(r.text)
  )
  check('run-as: no snippet path survives', !/from '\.\.\/snippets\//.test(r.text))
}

// --- arbitrary named export ----------------------------------------------

{
  const spec = `import { test, expect } from '@playwright/test'
import { escapeRegex } from '../snippets/_escape-regex'

test('flow', async ({ page }) => {
  await page.getByText(new RegExp(escapeRegex('a.b')))
})
`
  const r = run(spec, SNIPPETS)
  check('named helper: module inlined', r.modules.includes('_escape-regex'))
  check('named helper: binding emitted', /const \{ escapeRegex \} = \$escapeRegex/.test(r.text))
}

// --- transitive closure ---------------------------------------------------

{
  const spec = `import { test, expect } from '@playwright/test'
import { run as checkout } from '../snippets/checkout'

test('flow', async ({ page }) => {
  await checkout(page, { item: 'sauce-labs-backpack' })
})
`
  const r = run(spec, SNIPPETS)
  check(
    'closure: two hops pulled in',
    ['checkout', 'add-item-to-cart', '_escape-regex'].every((m) => r.modules.includes(m)),
    `got ${r.modules.join(', ')}`
  )
  check('closure: transitive set reported', r.transitive.sort().join() === '_escape-regex,add-item-to-cart')
  check('closure: direct set reported', r.directImports.join() === 'checkout')

  const at = (m) => r.text.indexOf(`const $${m} = (() =>`)
  check(
    'closure: dependencies defined before dependents',
    at('escapeRegex') < at('addItemToCart') && at('addItemToCart') < at('checkout'),
    'module consts are evaluated in order, so topological order is load-bearing'
  )
  check(
    'closure: dependency injected by destructuring',
    /const \$addItemToCart = \(\(\) => \{\n  const \{ escapeRegex \} = \$escapeRegex/.test(r.text)
  )
}

// --- execution: the generated file actually runs --------------------------
// Parses AND evaluates the output, so wrapping, injection and ordering are
// proven at runtime. A spec that loads but no-ops would pass a text check.

{
  const spec = `import { test, expect } from '@playwright/test'
import * as login from '../snippets/login'
import { run as checkout } from '../snippets/checkout'

test('flow', async ({ page }) => {
  await login.run(page, { username: 'standard_user' })
  const result = await checkout(page, { item: 'sauce-labs-backpack' })
  expect(result.ok).toBe(true)
})
`
  const r = run(spec, SNIPPETS)

  // Swap the Playwright import for injected stubs, then evaluate.
  const body = r.text.replace(/^import .*$/gm, '')
  const page = { calls: [] }
  let registered = null
  const testStub = (_name, fn) => {
    registered = fn
  }
  const expectStub = (actual) => ({
    toBe: (want) => {
      if (actual !== want) throw new Error(`expected ${want}, got ${actual}`)
    },
  })

  const err = caught(() => new Function('test', 'expect', body)(testStub, expectStub))
  check('execution: generated file evaluates', err === null, err?.message)

  if (!err && registered) {
    const runErr = caught(() => {
      const p = registered({ page })
      return p
    })
    check('execution: test callback starts', runErr === null, runErr?.message)
  }
}

// Await the async test body and assert the full call sequence — this is the
// check that fails loudly if a delegating run() short-circuits the test.
{
  const spec = `import { test, expect } from '@playwright/test'
import * as login from '../snippets/login'
import { run as checkout } from '../snippets/checkout'

test('flow', async ({ page }) => {
  await login.run(page, { username: 'standard_user' })
  await checkout(page, { item: 'sauce-labs-backpack' })
})
`
  const r = run(spec, SNIPPETS)
  const body = r.text.replace(/^import .*$/gm, '')
  const page = { calls: [] }
  let registered = null
  const err = caught(() =>
    new Function('test', 'expect', body)(
      (_n, fn) => {
        registered = fn
      },
      () => ({ toBe: () => {} })
    )
  )
  check('execution/sequence: evaluates', err === null, err?.message)

  if (registered) {
    await registered({ page })
    check(
      'execution/sequence: every step ran in order',
      page.calls.join(' | ') ===
        'login:standard_user | add:sauce-labs-backpack:button.add-to-cart | checkout',
      `got: ${page.calls.join(' | ')}`
    )
    check(
      'execution/sequence: delegating run() reached its sibling',
      page.calls[0] === 'login:standard_user',
      'a spliced run() body would have returned before login ever ran'
    )
  }
}

// --- spec body fidelity ---------------------------------------------------

{
  const specBody = `test('flow', async ({ page }) => {
  // a comment with '../snippets/login' inside it
  await login.run(page, { username: 'standard_user' })
  await expect(page.getByText('Total: $29.99')).toBeVisible({ timeout: 10_000 })
})
`
  const spec = `import { test, expect } from '@playwright/test'
import * as login from '../snippets/login'

${specBody}`
  const r = run(spec, SNIPPETS)
  check(
    'fidelity: body preserved byte-for-byte',
    r.text.endsWith(specBody),
    'call sites, selectors and assertions must survive untouched'
  )
}

// --- meta, types, declares ------------------------------------------------

{
  const snippets = {
    ...SNIPPETS,
    'read-inventory': `import { escapeRegex } from './_escape-regex'

export const meta = { description: 'Read inventory.', args: {}, tags: ['inventory'] }

declare const process: { env: Record<string, string | undefined> }

const KNOWN_ITEMS = ['backpack', 'bike-light']

export type KnownItem = typeof KNOWN_ITEMS[number]

export interface InventoryRow {
  name: string
  price: number
}

export async function run(page: any, args: { item: KnownItem }): Promise<InventoryRow[]> {
  return [{ name: escapeRegex(args.item), price: 29.99 }]
}
`,
  }
  const spec = `import { test, expect } from '@playwright/test'
import { run as readInventory } from '../snippets/read-inventory'

test('flow', async ({ page }) => {
  await readInventory(page, { item: 'backpack' })
})
`
  const r = run(spec, snippets)

  check('meta: library metadata dropped', !/const meta = \{/.test(r.text))
  check('meta: description text gone', !/Read inventory\./.test(r.text))

  const iife = r.text.slice(r.text.indexOf('const $readInventory'))
  check(
    'types: stay inside the module that owns them',
    /type KnownItem = typeof KNOWN_ITEMS\[number\]/.test(iife),
    'lifting a type defined from a module-local value strands it out of scope'
  )
  check('types: interface stays in place too', /interface InventoryRow \{/.test(iife))
  check('types: export keyword stripped', !/export (type|interface)/.test(r.text))
  check(
    'declares: lifted to the top level',
    r.text.indexOf('declare const process') < r.text.indexOf('const $'),
    'declare is illegal inside a function body'
  )
  check(
    'declares: emitted once, unindented',
    (r.text.match(/^declare const process/gm) ?? []).length === 1 &&
      !/\n[ \t]+declare /.test(r.text),
    'an indented copy would mean it was left inside an IIFE'
  )
}

// A type imported ACROSS modules has to be lifted, or the importer can't see it.
{
  const snippets = {
    'read-cart': `export interface CartRow { name: string }

export async function run(page) {
  return [{ name: 'backpack' }]
}
`,
    'sum-cart': `import { run as readCart } from './read-cart'
import type { CartRow } from './read-cart'

export async function run(page) {
  const rows: CartRow[] = await readCart(page)
  return rows.length
}
`,
  }
  const spec = `import { test, expect } from '@playwright/test'
import { run as sumCart } from '../snippets/sum-cart'

test('flow', async ({ page }) => {
  await sumCart(page)
})
`
  const r = run(spec, snippets)
  check(
    'types: cross-module type lifted to top level',
    r.text.indexOf('interface CartRow') < r.text.indexOf('const $'),
    'the importing module needs the name in scope'
  )
  check(
    'types: type-only import emits no runtime destructure',
    !/const \{ CartRow \}/.test(r.text),
    'a type has no runtime binding to destructure'
  )
}

// --- library commentary stripped, explanations kept -----------------------

{
  const snippets = {
    'open-cart': `// Authored by forge:curator on 2025-01-01 (PROJ-123 drive).
// Patched by forge:curator on 2025-01-02: recurred a fourth time for a fresh
// name — needs a live drive to isolate rather than a static read. No
// behavioural change made here.
//
// Opens the cart. Call after login.
export const meta = { description: 'Open the cart.', args: {}, tags: ['cart'] }

export async function run(page, args) {
  // 40s margin, not the usual 10s: a cold dev-server build can take that long
  // to mount the badge.
  await page.waitForSelector('.cart-badge', { timeout: 40000 })

  // Patched by forge:curator on 2025-01-03: switched to .first() after the
  // selector went ambiguous.
  await page.locator('.cart-link').first().click()

  // NOTE: the badge count lags the click by one tick.
  return { opened: true }
}
`,
  }
  const spec = `import { test, expect } from '@playwright/test'
import { run as openCart } from '../snippets/open-cart'

test('flow', async ({ page }) => {
  await openCart(page, {})
})
`
  const r = run(spec, snippets)

  check('comments: authorship line dropped', !/Authored by/.test(r.text))
  check('comments: patch narrative dropped', !/recurred a fourth time/.test(r.text))
  check(
    'comments: leading doc region dropped',
    !/Opens the cart\. Call after login\./.test(r.text),
    'the header region is library documentation, not test documentation'
  )
  check('comments: in-body patch note dropped', !/selector went ambiguous/.test(r.text))
  check('comments: explanatory caveat dropped too', !/40s margin/.test(r.text))
  check('comments: hedged NOTE dropped', !/the badge count lags the click/.test(r.text))
  check(
    'comments: no comment survives in an inlined module',
    !/^\s*\/\//m.test(r.text.slice(r.text.indexOf('const $openCart'), r.text.indexOf('test('))),
    'the module region should be code only'
  )

  check('comments: the code itself is intact', /\.cart-link'\)\.first\(\)\.click\(\)/.test(r.text))
  check('comments: the timeout survives its comment', /timeout: 40000/.test(r.text))
  check('comments: return value intact', /return \{ opened: true \}/.test(r.text))
}

// Trailing comments go, but only the comment — never the code beside them, and
// never a `//` that is really inside a string.
{
  const snippets = {
    'go-to-cart': `export async function run(page, args) {
  const BASE = 'https://www.saucedemo.com/' // canonical host
  await page.goto(BASE + 'cart.html') // trailing note
  const ratio = args.width / args.height // not a comment: division
  /* block form */
  await page.waitForURL('https://www.saucedemo.com/cart.html')
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(100)
  return { ratio }
}
`,
  }
  const spec = `import { test, expect } from '@playwright/test'
import { run as goToCart } from '../snippets/go-to-cart'

test('flow', async ({ page }) => {
  await goToCart(page, { width: 4, height: 3 })
})
`
  const r = run(spec, snippets)

  check('trailing: comment text removed', !/canonical host/.test(r.text) && !/trailing note/.test(r.text))
  check('trailing: block comment removed', !/block form/.test(r.text))
  check(
    'trailing: URL inside a string untouched',
    (r.text.match(/https:\/\/www\.saucedemo\.com\//g) ?? []).length === 2,
    'the // in https:// is string content, not a comment'
  )
  check('trailing: code beside the comment kept', /await page\.goto\(BASE \+ 'cart\.html'\)/.test(r.text))
  check(
    'trailing: division not mistaken for a comment',
    /const ratio = args\.width \/ args\.height/.test(r.text)
  )
  check(
    'trailing: functional directive preserved',
    /eslint-disable-next-line playwright\/no-wait-for-timeout/.test(r.text),
    'removing a suppression re-arms the rule it silenced'
  )
  // The body is re-indented into the IIFE, so assert leading whitespace exists
  // rather than a fixed width — the point is that stripping didn't eat it.
  check('trailing: indentation preserved', /^\s{4}await page\.waitForTimeout\(100\)$/m.test(r.text))
}

// Comment stripping is line-based, so a comment-SHAPED line that is really
// string content must not be touched — that would change behaviour silently
// while still compiling.
{
  const snippets = {
    'inject-shim': `// Authored by forge:curator on 2025-01-01.
export async function run(page, args) {
  await page.addInitScript(\`
// Authored by nobody — this line is script source, not a comment.
// Patched later: still script source.
window.__shim = true
\`)
  return { injected: true }
}
`,
  }
  const spec = `import { test, expect } from '@playwright/test'
import { run as injectShim } from '../snippets/inject-shim'

test('flow', async ({ page }) => {
  await injectShim(page, {})
})
`
  const r = run(spec, snippets)
  check(
    'comments: template-literal content preserved',
    /this line is script source, not a comment/.test(r.text) &&
      /Patched later: still script source/.test(r.text),
    'string content that looks like a comment must survive'
  )
  check('comments: the real authorship line still dropped', !/Authored by forge:curator/.test(r.text))
  check('comments: injected script intact', /window\.__shim = true/.test(r.text))
}

// The spec's own comments are the author's documentation of the scenario and
// must survive even when they look like provenance.
{
  const specBody = `test('flow', async ({ page }) => {
  // Patched by hand on 2025-01-01: this comment is the spec author's, not a
  // snippet's, so it stays.
  await login.run(page, { username: 'standard_user' })
})
`
  const spec = `// Reproduces: PROJ-123 — cart badge fails to increment.
// Authored by a human, and this header is the point of the artifact.
import { test, expect } from '@playwright/test'
import * as login from '../snippets/login'

${specBody}`
  const r = run(spec, SNIPPETS)
  check('comments: spec header preserved', /Reproduces: PROJ-123/.test(r.text))
  check(
    'comments: provenance-looking spec header preserved',
    /Authored by a human, and this header is the point/.test(r.text)
  )
  check('comments: spec body still byte-identical', r.text.endsWith(specBody))
}

// --- deduplication --------------------------------------------------------

{
  const spec = `import { test, expect } from '@playwright/test'
import { run as addItemToCart } from '../snippets/add-item-to-cart'
import { escapeRegex } from '../snippets/_escape-regex'

test('flow', async ({ page }) => {
  await addItemToCart(page, { item: 'a' })
  await addItemToCart(page, { item: 'b' })
  await addItemToCart(page, { item: escapeRegex('c.d') })
})
`
  const r = run(spec, SNIPPETS)
  const occurrences = (r.text.match(/const \$addItemToCart = \(\(\) =>/g) ?? []).length
  check('dedupe: module emitted once despite three call sites', occurrences === 1, `got ${occurrences}`)
  check(
    'dedupe: module shared between spec and snippet importers appears once',
    (r.text.match(/const \$escapeRegex = \(\(\) =>/g) ?? []).length === 1
  )
}

// --- external imports merged ---------------------------------------------

{
  const snippets = {
    ...SNIPPETS,
    'typed-step': `import type { Page } from '@playwright/test'
import { resolve } from 'node:path'

export async function run(page: Page, args: any) {
  return resolve('.')
}
`,
  }
  const spec = `import { test, expect } from '@playwright/test'
import { run as typedStep } from '../snippets/typed-step'
import * as login from '../snippets/login'

test('flow', async ({ page }) => {
  await login.run(page, { username: 'u' })
  await typedStep(page, {})
})
`
  const r = run(spec, snippets)
  const importLines = r.text.split('\n').filter((l) => l.startsWith('import '))
  const valueLines = importLines.filter((l) => !l.startsWith('import type '))
  check(
    'externals: one value import per source',
    valueLines.length === new Set(valueLines.map((l) => l.match(/from '(.+)'/)?.[1])).size,
    importLines.join(' ; ')
  )
  check('externals: node builtin carried through', importLines.some((l) => l.includes('node:path')))
  check(
    'externals: playwright value import present exactly once',
    valueLines.filter((l) => l.includes('@playwright/test')).length === 1,
    importLines.join(' ; ')
  )
  check(
    'externals: type-only name kept as an import type',
    importLines.includes("import type { Page } from '@playwright/test'"),
    importLines.join(' ; ')
  )
}

// --- fixture module -> env stub ------------------------------------------

{
  const snippets = {
    ...SNIPPETS,
    _persona: `import { test as base } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

declare const __dirname: string

const SCRIPTS_DIR = resolve(__dirname, '..', 'hints', 'scripts')

export const test = base.extend({
  persona: [
    async ({}, use) => {
      const n = execFileSync('bash', [resolve(SCRIPTS_DIR, 'claim.sh')]).toString()
      await use({ n })
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'
`,
  }
  const spec = `import { test, expect } from '../snippets/_persona'
import * as login from '../snippets/login'

test('flow', async ({ page, persona }) => {
  await login.run(page, persona)
})
`
  const r = run(spec, snippets)

  check('fixture: reported as replaced, not inlined', r.fixtureModules.join() === '_persona')
  check('fixture: not counted among inlined modules', !r.modules.includes('_persona'))
  check('fixture: base test imported for rebuilding', /import \{ test as base, expect \}/.test(r.text))
  check('fixture: stub extends base', /const test = base\.extend<[^>]*>\(\{/.test(r.text))
  check('fixture: stub reads an env var', /process\.env\.FORGE_FIXTURE_PERSONA/.test(r.text))
  check('fixture: stub throws when unset', /throw new Error\(/.test(r.text))
  check('fixture: warning surfaced', r.warnings.some((w) => w.includes('_persona')))
  check(
    'fixture: env var named in the warning',
    r.warnings.some((w) => w.includes('FORGE_FIXTURE_PERSONA'))
  )
  check(
    'fixture: project-local path machinery not carried over',
    !/claim\.sh/.test(r.text),
    "the fixture's own body must not travel"
  )
  check('fixture: no snippet path survives', !/from '\.\.\/snippets\//.test(r.text))

  check('fixtureNames: parses top-level fixture keys', fixtureNames(snippets._persona).join() === 'persona')
}

// --- failure modes --------------------------------------------------------

{
  const noImports = `import { test, expect } from '@playwright/test'

test('flow', async ({ page }) => {
  await page.goto('https://www.saucedemo.com/')
})
`
  const err = caught(() => run(noImports, SNIPPETS))
  check('failure: already-inlined spec exits 6', err?.code === 6, `got ${err?.code}`)
}

{
  const spec = `import { test, expect } from '@playwright/test'
import { run as missing } from '../snippets/does-not-exist'

test('flow', async ({ page }) => {
  await missing(page, {})
})
`
  const err = caught(() => run(spec, SNIPPETS))
  check('failure: missing snippet exits 7', err?.code === 7, `got ${err?.code}`)
  check('failure: missing snippet named', /does-not-exist/.test(err?.message ?? ''))
}

{
  const cyclic = {
    'step-a': `import { run as stepB } from './step-b'
export async function run(page) { return stepB(page) }
`,
    'step-b': `import { run as stepA } from './step-a'
export async function run(page) { return stepA(page) }
`,
  }
  const spec = `import { test, expect } from '@playwright/test'
import { run as stepA } from '../snippets/step-a'

test('flow', async ({ page }) => {
  await stepA(page)
})
`
  const err = caught(() => run(spec, cyclic))
  check('failure: dependency cycle exits 8', err?.code === 8, `got ${err?.code}`)
  check('failure: cycle path reported', /step-a.*→.*step-a/s.test(err?.message ?? ''))
}

// --- unit: clause parsing -------------------------------------------------

{
  const ns = parseImportClause(' * as login ')
  check('clause: namespace', ns.namespace === 'login' && ns.named.length === 0)

  const named = parseImportClause(' { run as findItem } ')
  check(
    'clause: named alias',
    named.named.length === 1 &&
      named.named[0].imported === 'run' &&
      named.named[0].local === 'findItem'
  )

  const multi = parseImportClause(' { test, expect } ')
  check('clause: multiple named', multi.named.map((b) => b.local).join() === 'test,expect')

  const typeOnly = parseImportClause(' type { Page } ')
  check('clause: type-only flagged', typeOnly.typeOnly === true)

  const inlineType = parseImportClause(' { run, type CartRow } ')
  check('clause: inline type specifier kept as a name', inlineType.named.length === 2)

  const wrapped = parseImportClause(' {\n  run as stepOne,\n  escapeRegex,\n} ')
  check('clause: multi-line clause', wrapped.named.map((b) => b.local).join() === 'stepOne,escapeRegex')
}

// --- unit: module analysis -----------------------------------------------

{
  const mod = analyseModule('login', SNIPPETS.login)
  check('analyse: exports collected', mod.exportNames.sort().join() === 'login,run')
  check('analyse: meta not an export', !mod.exportNames.includes('meta'))
  check('analyse: not a fixture module', mod.isFixtureModule === false)

  const dep = analyseModule('checkout', SNIPPETS.checkout)
  check('analyse: sibling dependency found', dep.deps.map((d) => d.module).join() === 'add-item-to-cart')

  const reexport = analyseModule(
    'with-reexport',
    `async function openFilter(page) { return 1 }
export { openFilter }

export async function run(page) { return openFilter(page) }
`
  )
  check(
    'analyse: bare re-export counted as an export',
    reexport.exportNames.sort().join() === 'openFilter,run'
  )
  check('analyse: re-export statement removed from body', !/export \{ openFilter \}/.test(reexport.body))
}

// --- CLI contract ---------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), 'forge-export-'))
try {
  const forgeRoot = join(tmp, 'forge')
  mkdirSync(join(forgeRoot, 'specs'), { recursive: true })
  mkdirSync(join(forgeRoot, 'snippets'), { recursive: true })
  for (const [name, src] of Object.entries(SNIPPETS)) {
    writeFileSync(join(forgeRoot, 'snippets', `${name}.ts`), src)
  }
  const specPath = join(forgeRoot, 'specs', 'cart.spec.ts')
  writeFileSync(
    specPath,
    `import { test, expect } from '@playwright/test'
import { run as checkout } from '../snippets/checkout'

test('cart', async ({ page }) => {
  await checkout(page, { item: 'sauce-labs-backpack' })
})
`
  )

  const cli = (args) => spawnSync('node', [CLI, 'export-spec', ...args], { encoding: 'utf8' })
  const outPath = join(tmp, 'out', 'cart.spec.ts')
  mkdirSync(join(tmp, 'out'), { recursive: true })

  const ok = cli(['--spec', specPath, '--output', outPath])
  check('cli: exits 0 on success', ok.status === 0, ok.stderr)
  check('cli: output written', existsSync(outPath))
  check(
    'cli: reports the transitive count',
    /pulled in transitively/.test(ok.stdout),
    ok.stdout
  )
  if (existsSync(outPath)) {
    const written = readFileSync(outPath, 'utf8')
    check('cli: written file is self-contained', !/from '\.\.\/snippets\//.test(written))
    check('cli: header names the source spec', written.includes('cart.spec.ts'))
  }

  const clobber = cli(['--spec', specPath, '--output', outPath])
  check('cli: refuses to clobber without --force', clobber.status === 5, `got ${clobber.status}`)

  const forced = cli(['--spec', specPath, '--output', outPath, '--force'])
  check('cli: --force overwrites', forced.status === 0, forced.stderr)

  const missing = cli(['--spec', join(forgeRoot, 'specs', 'nope.spec.ts'), '--output', outPath, '-f'])
  check('cli: missing spec exits 4', missing.status === 4, `got ${missing.status}`)

  const badArg = cli(['--spec', specPath, '--output', outPath, '--nonsense'])
  check('cli: unknown arg exits 2', badArg.status === 2, `got ${badArg.status}`)

  const noOutput = cli(['--spec', specPath])
  check('cli: missing --output exits 2', noOutput.status === 2, `got ${noOutput.status}`)

  const help = cli(['--help'])
  check('cli: --help exits 0', help.status === 0)
  check('cli: --help documents usage', /--spec/.test(help.stdout))
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// --- report ---------------------------------------------------------------

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('forge-export-spec: all checks passed')
