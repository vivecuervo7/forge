#!/usr/bin/env node
// forge-act.test.mjs — the pure parts of the watched-action verb: argument
// parsing, expectation matching, mutation-log partitioning, and the run-code
// body it builds. Everything here is a pure transform (no browser, no spawn),
// so it's unit-tested by import; the in-page half is exercised by driving a
// real session.
//
// Run: node scripts/forge-act.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import {
  parseArgs, parseExpect, matches, partitionLog, viewNames,
  parseObserveChanges, isBaselineView, buildBody, playwrightCode,
} from './lib/act.mjs'

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`)
}

// --- argument parsing ---

const clickArgs = parseArgs(['-s=demo', 'click', 'e12'])
eq('click: session/action/ref', [clickArgs.session, clickArgs.action, clickArgs.ref], ['demo', 'click', 'e12'])

const fillArgs = parseArgs(['-s=demo', 'fill', 'e3', 'standard_user'])
eq('fill: value is the third positional', fillArgs.value, 'standard_user')

// goto takes a URL where a ref would otherwise sit.
const gotoArgs = parseArgs(['-s=demo', 'goto', 'https://example.com'])
eq('goto: url lands in value, not ref', [gotoArgs.ref, gotoArgs.value], [null, 'https://example.com'])

const optArgs = parseArgs(['-s=demo', 'click', 'e1', '--expect=alert:saved', '--quiet=250', '--timeout=3000'])
eq('options parse', [optArgs.expect, optArgs.quiet, optArgs.timeout], ['alert:saved', 250, 3000])
eq('--expect-none is a flag', parseArgs(['--expect-none']).expectNone, true)
eq('--session= long form', parseArgs(['--session=demo']).session, 'demo')

// A value that looks like a flag must survive as a value.
eq('value beginning with a dash is not eaten', parseArgs(['-s=d', 'fill', 'e1', '-5']).value, '-5')

// --- expectation parsing + matching ---

eq('role only', parseExpect('alert'), { role: 'alert', text: null })
eq('role:text', parseExpect('alert:Saved'), { role: 'alert', text: 'saved' })
eq('empty text after colon is treated as absent', parseExpect('alert:'), { role: 'alert', text: null })
eq('no expectation', parseExpect(null), null)

const cands = [{ role: 'alert', name: 'Item added to cart' }, { role: 'button', name: 'Checkout' }]
eq('role match', matches(parseExpect('alert'), cands), true)
eq('role+substring match is case-insensitive', matches(parseExpect('alert:ADDED'), cands), true)
eq('right role, wrong text', matches(parseExpect('alert:removed'), cands), false)
eq('wrong role', matches(parseExpect('status'), cands), false)
eq('no candidates', matches(parseExpect('alert'), []), false)

// --- mutation-log partitioning ---

// A toast that appeared and vanished is the transient case: no later observe,
// however well timed, could have seen it.
eq(
  'appeared then gone → transient',
  partitionLog([
    { edge: 'appeared', role: 'alert', name: 'Saved' },
    { edge: 'gone', role: 'alert', name: 'Saved' },
  ]),
  { transient: [{ role: 'alert', name: 'Saved' }], unlisted: [] },
)

// Still present, but observe's filtered view doesn't carry it (a validation
// message rendered as a heading) — the thing that explains the outcome.
eq(
  'appeared, still present, absent from the view → unlisted',
  partitionLog([{ edge: 'appeared', role: 'h3', name: 'Username is required' }], new Set()),
  { transient: [], unlisted: [{ role: 'h3', name: 'Username is required' }] },
)

// Already in the settled view → the diff reports it; repeating would bury the signal.
eq(
  'appeared and present in the view → reported by neither',
  partitionLog([{ edge: 'appeared', role: 'button', name: 'Checkout' }], new Set(['Checkout'])),
  { transient: [], unlisted: [] },
)

eq(
  'repeats collapse to one entry',
  partitionLog([
    { edge: 'appeared', role: 'alert', name: 'Saved' },
    { edge: 'appeared', role: 'alert', name: 'Saved' },
    { edge: 'gone', role: 'alert', name: 'Saved' },
  ]).transient,
  [{ role: 'alert', name: 'Saved' }],
)

eq('empty log', partitionLog([]), { transient: [], unlisted: [] })

check(
  'a noisy log is capped',
  partitionLog(Array.from({ length: 50 }, (_, i) => ({ edge: 'appeared', role: 'div', name: `n${i}` }))).unlisted.length === 12,
)

// --- reading observe's output back ---

const marked = `  [e11] textbox "Username"\n+ [e27] alert "Saved"\n~ button "Checkout"\n- link "Gone"`
eq(
  'only marked lines are candidates by default',
  parseObserveChanges(marked),
  [{ role: 'alert', name: 'Saved' }, { role: 'button', name: 'Checkout' }, { role: 'link', name: 'Gone' }],
)
eq(
  'all=true also picks up unmarked lines',
  parseObserveChanges(`  [e11] textbox "Username"\n  [e15] button "Login"`, true),
  [{ role: 'textbox', name: 'Username' }, { role: 'button', name: 'Login' }],
)
eq('names for view membership', [...viewNames(marked)], ['Username', 'Saved', 'Checkout', 'Gone'])

// The re-baseline detection that decides between those two readings. After a
// navigation observe emits an unmarked full view, so matching only marked
// lines would find nothing on a page that entirely just appeared.
check('full (navigation) is a baseline', isBaselineView('# observe: s=x | 27 interactable, 0 signal | full (navigation) | ~9 tok'))
check('full (baseline) is a baseline', isBaselineView('# observe: s=x | 3 interactable, 0 signal | full (baseline) | ~9 tok'))
check('full+marks is NOT a baseline', !isBaselineView('# observe: s=x | 4 interactable, 0 signal | full+marks (1 changed) | ~9 tok'))
check('diff is NOT a baseline', !isBaselineView('# observe: s=x | 4 interactable, 0 signal | diff (2 changes) | ~9 tok'))

// --- the generated run-code body ---

const body = buildBody({ action: 'click', ref: 'e12', value: null, quiet: 500, timeout: 8000 })
check('body is a page arrow function', body.startsWith('async page => {'))
check('ref resolves through the aria-ref engine', body.includes('aria-ref=e12'))
check('observer is installed before the action', body.indexOf('MutationObserver') < body.indexOf('.click()'))
check('settle honours the quiet window', body.includes('>= 500'))
check('settle is bounded by the timeout', body.includes('< 8000'))

// Values are JSON-embedded, so quotes and backslashes can't break out of the
// generated source.
const tricky = buildBody({ action: 'fill', ref: 'e3', value: 'a"b\\c', quiet: 500, timeout: 8000 })
check('a value with quotes/backslashes is safely embedded', tricky.includes(JSON.stringify('a"b\\c')))
check('goto targets the page, not a locator', buildBody({ action: 'goto', ref: null, value: 'https://example.com', quiet: 1, timeout: 1 }).includes('page.goto("https://example.com")'))
check('type maps to pressSequentially', buildBody({ action: 'type', ref: 'e3', value: 'hi', quiet: 1, timeout: 1 }).includes('pressSequentially'))

// --- the echoed Playwright code ---
//
// The curator authors snippets from this echo and a spec is composed from it,
// so a per-snapshot `aria-ref` must never pass silently as a durable selector.

eq(
  'click echoes the resolved semantic locator',
  playwrightCode({ action: 'click', ref: 'e15', value: null }, `locator('[data-test="login-button"]')`),
  `await page.locator('[data-test="login-button"]').click();`,
)
eq(
  'fill echoes its value',
  playwrightCode({ action: 'fill', ref: 'e3', value: 'standard_user' }, `getByLabel('Username')`),
  `await page.getByLabel('Username').fill("standard_user");`,
)
eq(
  'type maps to pressSequentially in the echo too',
  playwrightCode({ action: 'type', ref: 'e3', value: 'hi' }, `getByLabel('U')`),
  `await page.getByLabel('U').pressSequentially("hi");`,
)
eq(
  'select maps to selectOption',
  playwrightCode({ action: 'select', ref: 'e4', value: 'AU' }, `getByRole('combobox')`),
  `await page.getByRole('combobox').selectOption("AU");`,
)
eq(
  'goto needs no locator',
  playwrightCode({ action: 'goto', ref: null, value: 'https://example.com' }, null),
  `await page.goto("https://example.com");`,
)
eq(
  'an unresolved ref is echoed, but flagged rather than passed off as durable',
  playwrightCode({ action: 'click', ref: 'e9', value: null }, null),
  `await page.locator('aria-ref=e9').click();  // unresolved ref — needs a durable selector`,
)

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-act: all watched-action cases pass')
