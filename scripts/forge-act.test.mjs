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
  assertionFor, suggestPostcondition, urlAssertion, looksDynamicId,
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

// A flag act doesn't have was silently dropped in a real drive, so it looked
// honoured. It's collected and reported instead.
eq('an unknown flag is collected, not silently dropped', parseArgs(['-s=d', 'click', 'e1', '--json']).unknownFlags, ['--json'])
eq('an unknown flag does not become a positional', parseArgs(['-s=d', 'click', 'e1', '--json']).ref, 'e1')
eq('known flags are not reported as unknown', parseArgs(['-s=d', 'click', 'e1', '--raw', '--expect=alert']).unknownFlags, [])

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

// --- postconditions: the wait a snippet inherits ---
//
// Left implicit, the settle `act` performs is invisible to the composed
// snippet, and the curator authors a bare click that races. These turn the
// signal the driver already relied on into the gate the snippet waits for.

eq(
  'an ARIA role becomes a getByRole wait',
  assertionFor({ role: 'alert', name: 'Added to cart' }),
  `await expect(page.getByRole('alert', { name: "Added to cart" })).toBeVisible();`,
)
eq(
  'a heading tag maps to the heading role, which is what exists',
  assertionFor({ role: 'h3', name: 'Username is required' }),
  `await expect(page.getByRole('heading', { name: "Username is required" })).toBeVisible();`,
)
eq(
  'a non-ARIA tag falls back to text',
  assertionFor({ role: 'span', name: '1' }),
  `await expect(page.getByText("1")).toBeVisible();`,
)

// Ranking: durability across runs, not whatever changed first.
eq(
  'a live region outranks a landmark',
  suggestPostcondition([
    { role: 'button', name: 'Remove' },
    { role: 'alert', name: 'Product added to shopping cart.' },
  ]),
  { kind: 'role', role: 'alert', name: 'Product added to shopping cart.' },
)
eq(
  'a navigation outranks a landmark when no live region appeared',
  suggestPostcondition([{ role: 'button', name: 'Remove' }], { navigated: true, url: 'https://shop.test/inventory.html' }),
  { kind: 'url', assertion: `await expect(page).toHaveURL(/\\/inventory\\.html\\/?$/);` },
)
eq(
  'a landmark is taken when nothing better occurred',
  suggestPostcondition([{ role: 'span', name: '1' }, { role: 'button', name: 'Remove' }]),
  { kind: 'role', role: 'button', name: 'Remove' },
)

// Instance content verifies this run and breaks the next one.
eq(
  'content roles are excluded outright',
  suggestPostcondition([{ role: 'img', name: 'Backpack photo' }, { role: 'gridcell', name: '$29.99' }]),
  null,
)
eq('nothing observed → nothing suggested', suggestPostcondition([]), null)
eq('a nameless change is not a signal', suggestPostcondition([{ role: 'alert', name: '' }]), null)

// URL waits: an id that varies per run makes a useless assertion.
check('a numeric segment is dynamic', looksDynamicId('12345'))
check('a uuid segment is dynamic', looksDynamicId('3f2504e0-4f89-11d3-9a0c-0305e82c3301'))
check('a word segment is not dynamic', !looksDynamicId('inventory'))
// A real ULID slipped a digits/hex/UUID check and hard-coded one product into a
// suggested wait, so the rule is now "long opaque alphanumeric run with a digit"
// rather than an enumeration of formats.
check('a ULID segment is dynamic', looksDynamicId('01KYGVP859P19531MVQQ0Q4RHP'))
check('a nanoid-ish segment is dynamic', looksDynamicId('V1StGXR8Z5jdHi6BmyT'))
check('a hyphenated slug is not dynamic', !looksDynamicId('sauce-labs-backpack'))
check('a dotted filename is not dynamic', !looksDynamicId('inventory.html'))
check('a long digitless word is not dynamic', !looksDynamicId('administratorsettings'))
check('a short versioned segment is not dynamic', !looksDynamicId('v2'))
eq(
  'a dynamic segment is generalised, with every separator escaped',
  urlAssertion('https://shop.test/product/98765/detail'),
  `await expect(page).toHaveURL(/\\/product\\/[^\\/]+\\/detail\\/?$/);`,
)
eq('the root is not a distinctive destination', urlAssertion('https://shop.test/'), null)
eq('an unparseable url yields no wait', urlAssertion('not a url'), null)

// The emitted line is source the curator pastes into a snippet, so the regex it
// contains has to actually parse — and match the page it was derived from.
for (const [label, url, alsoMatches] of [
  ['simple path', 'https://shop.test/inventory.html', 'https://shop.test/inventory.html'],
  ['dynamic id', 'https://shop.test/product/98765/detail', 'https://shop.test/product/42/detail'],
]) {
  const line = urlAssertion(url)
  const src = /toHaveURL\((\/.*\/)\)/.exec(line)?.[1]
  let re = null
  try { re = eval(src) } catch { /* reported below */ }
  check(`${label}: emitted regex parses`, re instanceof RegExp, `from ${line}`)
  if (re) {
    check(`${label}: matches the observed url`, re.test(new URL(url).pathname))
    check(`${label}: matches an equivalent url`, re.test(new URL(alsoMatches).pathname))
    check(`${label}: does not match an unrelated path`, !re.test('/something/else'))
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-act: all watched-action cases pass')
