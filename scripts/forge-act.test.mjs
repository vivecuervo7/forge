#!/usr/bin/env node
// forge-act.test.mjs — the pure parts of the watched-action verb: argument
// parsing, gate-candidate ranking, mutation-log partitioning, and the run-code
// body it builds. Everything here is a pure transform (no browser, no spawn),
// so it's unit-tested by import; the in-page half is exercised by driving a
// real session.
//
// Run: node scripts/forge-act.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import {
  parseArgs, partitionLog, viewNames,
  parseObserveChanges, isBaselineView, buildBody, playwrightCode,
  assertionFor, gateCandidates, candidateLine, urlAssertion, looksDynamicId, gateTimeout,
  isRef, asSelector, locatorFor,
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
eq('click: session/action/target', [clickArgs.session, clickArgs.action, clickArgs.target], ['demo', 'click', 'e12'])

const fillArgs = parseArgs(['-s=demo', 'fill', 'e3', 'standard_user'])
eq('fill: value is the third positional', fillArgs.value, 'standard_user')

// goto takes a URL where a ref would otherwise sit.
const gotoArgs = parseArgs(['-s=demo', 'goto', 'https://example.com'])
eq('goto: url lands in value, not target', [gotoArgs.target, gotoArgs.value], [null, 'https://example.com'])

const optArgs = parseArgs(['-s=demo', 'click', 'e1', '--quiet=250', '--timeout=3000'])
eq('options parse', [optArgs.quiet, optArgs.timeout], [250, 3000])
eq('--session= long form', parseArgs(['--session=demo']).session, 'demo')

// act deliberately has no way to declare an expected outcome. A driver reaching
// for the removed flag is told why, rather than having it silently dropped.
eq('a removed --expect flag is caught', parseArgs(['-s=d', 'click', 'e1', '--expect=alert']).unknownFlags, ['--expect=alert'])

// A flag act doesn't have was silently dropped in a real drive, so it looked
// honoured. It's collected and reported instead.
eq('an unknown flag is collected, not silently dropped', parseArgs(['-s=d', 'click', 'e1', '--json']).unknownFlags, ['--json'])
eq('an unknown flag does not become a positional', parseArgs(['-s=d', 'click', 'e1', '--json']).target, 'e1')
eq('known flags are not reported as unknown', parseArgs(['-s=d', 'click', 'e1', '--raw', '--quiet=100']).unknownFlags, [])

// A value that looks like a flag must survive as a value.
eq('value beginning with a dash is not eaten', parseArgs(['-s=d', 'fill', 'e1', '-5']).value, '-5')

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

// --- targets: a ref OR a selector ---
//
// Taking only refs meant a driver wanting the generalisable form had to drop to
// `run-code`, losing the watched window and the gate candidates on exactly the
// actions most worth capturing.

check('an observe ref is recognised', isRef('e12'))
check('a multi-digit ref is recognised', isRef('e1652'))
check('a css selector is not a ref', !isRef('[data-test="product-name"]'))
check('a selector that merely starts with e is not a ref', !isRef('em.price'))
check('an empty target is not a ref', !isRef(''))

eq('a ref becomes an aria-ref selector', asSelector('e12'), 'aria-ref=e12')
eq('a selector passes through untouched', asSelector('[data-test="row"] >> nth=0'), '[data-test="row"] >> nth=0')

eq(
  'buildBody targets a ref through the aria-ref engine',
  buildBody({ action: 'click', target: 'e12', value: null, quiet: 1, timeout: 1 }).includes('"aria-ref=e12"'),
  true,
)
eq(
  'buildBody targets a selector verbatim',
  buildBody({ action: 'click', target: '[data-test="product-name"] >> nth=0', value: null, quiet: 1, timeout: 1 })
    .includes(JSON.stringify('[data-test="product-name"] >> nth=0')),
  true,
)

// A supplied selector is already durable, so there is nothing to resolve — and
// crucially no subprocess to spawn, so this is safe to assert without a session.
const SEL = '[data-test="product-name"] >> nth=0'
eq('a selector needs no resolution and is echoed as given', locatorFor('no-such-session', SEL), `locator(${JSON.stringify(SEL)})`)
eq('an empty target resolves to nothing', locatorFor('s', null), null)

eq(
  'a selector target echoes durable code with no unresolved-ref marker',
  playwrightCode({ action: 'click', target: SEL, value: null }, `locator(${JSON.stringify(SEL)})`),
  `await page.locator(${JSON.stringify(SEL)}).click();`,
)

// --- the generated run-code body ---

const body = buildBody({ action: 'click', target: 'e12', value: null, quiet: 500, timeout: 8000 })
check('body is a page arrow function', body.startsWith('async page => {'))
check('ref resolves through the aria-ref engine', body.includes('aria-ref=e12'))
check('observer is installed before the action', body.indexOf('MutationObserver') < body.indexOf('.click()'))
check('settle honours the quiet window', body.includes('>= 500'))
check('settle is bounded by the timeout', body.includes('< 8000'))

// Values are JSON-embedded, so quotes and backslashes can't break out of the
// generated source.
const tricky = buildBody({ action: 'fill', target: 'e3', value: 'a"b\\c', quiet: 500, timeout: 8000 })
check('a value with quotes/backslashes is safely embedded', tricky.includes(JSON.stringify('a"b\\c')))
check('goto targets the page, not a locator', buildBody({ action: 'goto', target: null, value: 'https://example.com', quiet: 1, timeout: 1 }).includes('page.goto("https://example.com")'))
check('type maps to pressSequentially', buildBody({ action: 'type', target: 'e3', value: 'hi', quiet: 1, timeout: 1 }).includes('pressSequentially'))

// --- the echoed Playwright code ---
//
// The curator authors snippets from this echo and a spec is composed from it,
// so a per-snapshot `aria-ref` must never pass silently as a durable selector.

eq(
  'click echoes the resolved semantic locator',
  playwrightCode({ action: 'click', target: 'e15', value: null }, `locator('[data-test="login-button"]')`),
  `await page.locator('[data-test="login-button"]').click();`,
)
eq(
  'fill echoes its value',
  playwrightCode({ action: 'fill', target: 'e3', value: 'standard_user' }, `getByLabel('Username')`),
  `await page.getByLabel('Username').fill("standard_user");`,
)
eq(
  'type maps to pressSequentially in the echo too',
  playwrightCode({ action: 'type', target: 'e3', value: 'hi' }, `getByLabel('U')`),
  `await page.getByLabel('U').pressSequentially("hi");`,
)
eq(
  'select maps to selectOption',
  playwrightCode({ action: 'select', target: 'e4', value: 'AU' }, `getByRole('combobox')`),
  `await page.getByRole('combobox').selectOption("AU");`,
)
eq(
  'goto needs no locator',
  playwrightCode({ action: 'goto', target: null, value: 'https://example.com' }, null),
  `await page.goto("https://example.com");`,
)
eq(
  'an unresolved ref is echoed, but flagged rather than passed off as durable',
  playwrightCode({ action: 'click', target: 'e9', value: null }, null),
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

// Gate candidates: a ranked SHORTLIST, never a single pick. Offering one pick
// reads as a decision already made and hides that there was a trade-off; the
// curator chooses knowing what the snippet is for.

const tiersOf = list => list.map(c => c.tier)

eq(
  'ranked live region → navigation → landmark',
  tiersOf(gateCandidates(
    [{ role: 'button', name: 'Remove' }, { role: 'alert', name: 'Product added to shopping cart.' }],
    { navigated: true, url: 'https://shop.test/checkout' },
  )),
  ['live region', 'navigation', 'landmark'],
)
eq(
  'the best candidate leads',
  candidateLine(gateCandidates([
    { role: 'button', name: 'Remove' },
    { role: 'alert', name: 'Product added to shopping cart.' },
  ])[0]),
  `await expect(page.getByRole('alert', { name: "Product added to shopping cart." })).toBeVisible({ timeout: 5000 });`,
)
eq(
  'a navigation is offered when no live region appeared',
  gateCandidates([{ role: 'button', name: 'Remove' }], { navigated: true, url: 'https://shop.test/inventory.html' })[0],
  { kind: 'url', assertion: `await expect(page).toHaveURL(/\\/inventory\\.html\\/?$/, { timeout: 5000 });`, tier: 'navigation', timeoutMs: 5000 },
)

// A short list is better than a padded one; three is the cap.
check('the shortlist is capped at three', gateCandidates(
  Array.from({ length: 9 }, (_, i) => ({ role: 'button', name: `B${i}` })),
).length === 3)
eq(
  'duplicates collapse rather than filling the list',
  gateCandidates([
    { role: 'alert', name: 'Saved' }, { role: 'alert', name: 'Saved' }, { role: 'button', name: 'Close' },
  ]).length,
  2,
)

// An empty shortlist is a real answer — better no gate plus a caveat than a
// confident wrong one.
eq(
  'instance content yields no candidate at all',
  gateCandidates([{ role: 'img', name: 'Backpack photo' }, { role: 'gridcell', name: '$29.99' }]),
  [],
)
eq('nothing observed → no candidates', gateCandidates([]), [])
eq('a nameless change is not a signal', gateCandidates([{ role: 'alert', name: '' }]), [])

// A gate's timeout is grounded in what THIS action took to settle, not a
// guessed constant — a page that took 5s to quiet deserves more headroom than
// one that took 500ms, and the run just measured which it is.
eq('a fast settle still gets a 5s floor', gateTimeout(515), 5000)
eq('a slow settle scales to 3x, rounded up to the second', gateTimeout(2916), 9000)
eq('a very slow settle scales further', gateTimeout(5209), 16000)
eq('no measurement falls back to the floor', gateTimeout(), 5000)

// The emitted gate carries that timeout. An untimed `waitFor` pends to the whole
// test timeout, which is the hang footgun lint-spec exists to catch.
eq(
  'a role gate carries its timeout',
  candidateLine(gateCandidates([{ role: 'alert', name: 'Saved' }], { settleMs: 2916 })[0]),
  `await expect(page.getByRole('alert', { name: "Saved" })).toBeVisible({ timeout: 9000 });`,
)
eq(
  'a url gate carries its timeout',
  candidateLine(gateCandidates([], { navigated: true, url: 'https://x.test/checkout', settleMs: 515 })[0]),
  `await expect(page).toHaveURL(/\\/checkout\\/?$/, { timeout: 5000 });`,
)

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
