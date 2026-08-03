#!/usr/bin/env node
// forge-observe.test.mjs — snapshot parsing for the perception primitive.
// `extract` is a pure YAML-text → items transform (no browser, no spawn), so
// it's unit-tested by import.
//
// The bulk of these cases pin ONE defect class: Playwright quotes a snapshot
// line whenever plain YAML would reparse it wrongly, and the parser has to
// understand that quoting. It didn't — so every element whose accessible name
// contained `: ` was silently dropped from the driver's view, with the header's
// own count agreeing with itself. Prices, error prefixes, and "Category: Item"
// labels are common enough that this blinded the driver to real controls; a
// dropdown whose options all carried colons observed as empty, which is
// indistinguishable from "the options never loaded".
//
// Run: node scripts/forge-observe.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { extract } from './lib/observe.mjs'

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`)
}
// Most cases care about "did we see this element, with this ref" rather than
// the whole record.
const seen = yaml => extract(yaml).map(it => `${it.role} ${JSON.stringify(it.name)}${it.ref ? ` [${it.ref}]` : ''}`)

// --- the regression: quoted keys must not vanish ---

eq(
  'colon in name, with children (quoted key + trailing colon)',
  seen(`- 'link "Sauce Labs Backpack: $29.99" [ref=e11]':\n    - /url: /item/4`),
  ['link "Sauce Labs Backpack: $29.99" [e11]'],
)
eq(
  'colon in name, no children (quoted key, no trailing colon)',
  seen(`- 'button "Add to cart: Sauce Labs Backpack" [ref=e12]'`),
  ['button "Add to cart: Sauce Labs Backpack" [e12]'],
)
eq(
  'quoted key keeps flags and skips cursor noise',
  seen(`- 'button "Sort by: Price" [expanded] [ref=e7] [cursor=pointer]':`),
  ['button "Sort by: Price" [e7]'],
)
eq(
  'quoted key with a flag but no ref is still kept (it has a name)',
  seen(`- 'button "Add to cart: Sauce Labs Fleece" [disabled]':`),
  ['button "Add to cart: Sauce Labs Fleece"'],
)
eq(
  "inner apostrophe is YAML-doubled and must be restored",
  seen(`- 'menuitem "Owner''s menu: settings" [ref=e5]'`),
  ['menuitem "Owner\'s menu: settings" [e5]'],
)

// A dropdown whose options all carry colons: previously observed as empty,
// which reads exactly like "the options never rendered".
eq(
  'every option in a colon-named dropdown survives',
  seen(
    `- listbox "Timeslot" [ref=e20]:\n` +
    `  - 'option "Morning: 09:00" [active] [ref=e21]'\n` +
    `  - 'option "Afternoon: 13:00" [ref=e22]'\n` +
    `  - 'option "Evening: 17:00" [ref=e23]'`,
  ),
  [
    'listbox "Timeslot" [e20]',
    'option "Morning: 09:00" [e21]',
    'option "Afternoon: 13:00" [e22]',
    'option "Evening: 17:00" [e23]',
  ],
)

// Signals are the worst case: a dropped alert means the driver never learns the
// action failed. Error text is a prime colon-carrier.
eq(
  'a colon-bearing alert still surfaces as a signal',
  seen(`- 'alert "Error: Username is required" [ref=e9]'`),
  ['alert "Error: Username is required" [e9]'],
)

// --- quoted values ---

eq(
  'a quoted value is unwrapped, not left with literal quotes',
  extract(`- alert [ref=e9]:\n  - text: "Error: Username is required"`).map(it => it.name),
  ['Error: Username is required'],
)
eq(
  'escapes inside a quoted value are decoded',
  extract(`- alert [ref=e9]:\n  - text: "Say \\"hi\\": now"`).map(it => it.name),
  ['Say "hi": now'],
)

// --- pass-through: the ordinary forms must be untouched ---

eq(
  'plain element with children',
  seen(`- link "Sauce Labs Backpack" [ref=e10]:\n    - /url: /item/4`),
  ['link "Sauce Labs Backpack" [e10]'],
)
eq('plain element, no children', seen(`- button "Checkout" [ref=e13]`), ['button "Checkout" [e13]'])
eq(
  'unquoted value still reads as state',
  extract(`- textbox "Username" [ref=e3]: standard_user`).map(it => it.state),
  ['standard_user'],
)
eq('non-element text line yields nothing', seen(`- text: for this application.`), [])
eq(
  'unactionable + unlabelled element is still dropped as noise',
  seen(`- combobox`),
  [],
)
eq('empty input', seen(''), [])

// Mixed document: the colon-bearing entries are exactly the ones that used to
// disappear, so the ordering here is the real proof.
eq(
  'mixed document keeps every actionable element in order',
  seen(
    `- generic [ref=e1]:\n` +
    `  - link "Sauce Labs Backpack" [ref=e10]:\n` +
    `    - /url: /item/4\n` +
    `  - 'link "Sauce Labs Bike Light: $9.99" [ref=e11]':\n` +
    `    - /url: /item/0\n` +
    `  - 'button "Add to cart: Bike Light" [ref=e12]'\n` +
    `  - button "Checkout" [ref=e13]`,
  ),
  [
    'link "Sauce Labs Backpack" [e10]',
    'link "Sauce Labs Bike Light: $9.99" [e11]',
    'button "Add to cart: Bike Light" [e12]',
    'button "Checkout" [e13]',
  ],
)

// --- relevance: informative content, not an allowlist of roles ---
//
// The allowlist this replaces excluded whole categories of meaningful content by
// construction. On a real drive a failed login surfaced an unnamed dismiss
// button and NOT the error text beside it — the driver could see that something
// went wrong but not what, and re-observing never recovered it.

eq(
  'a validation message rendered as a heading reaches the view',
  seen(`- heading "Epic sadface: Username is required" [level=3] [ref=e26]`),
  ['heading "Epic sadface: Username is required" [e26]'],
)
eq(
  "a data grid's cells reach the view",
  seen(`- gridcell "Forge Test: Observe CS" [ref=e366]\n- columnheader "Name" [ref=e360]`),
  ['gridcell "Forge Test: Observe CS" [e366]', 'columnheader "Name" [e360]'],
)

// An interactable earns its place by being actionable, so a ref is enough —
// an icon button or a close `X` has no name and is still what you click.
eq(
  'an unnamed interactable with a ref is kept',
  seen(`- button "" [ref=e27]`),
  ['button "" [e27]'],
)
eq(
  'an unnamed, ref-less interactable is still noise',
  seen(`- combobox`),
  [],
)
// Anything non-interactive earns its place by telling you something.
eq(
  'an unnamed non-interactive element is dropped',
  seen(`- figure [ref=e40]`),
  [],
)

// Roles the platform marks as having no semantics, and the snapshot's own
// metadata lines, are the bulk of a page and carry nothing on their own.
eq(
  'anonymous roles and /meta lines are dropped, semantic siblings kept',
  seen(
    `- generic "Cmd" [ref=e5]\n` +
    `- text: for this application.\n` +
    `- /url: /product/4\n` +
    `- heading "Checkout" [ref=e7]`,
  ),
  ['heading "Checkout" [e7]'],
)

// A row's accessible name is its cells' text concatenated, so keeping both
// reports every value twice — measured at 92 rows against 90 identically-named
// gridcells on one page. The children are more precise, so the container goes.
eq(
  'a container whose name is just its children is dropped in favour of them',
  seen(`- row "Alice Smith Active" [ref=e50]:\n  - gridcell "Alice Smith" [ref=e51]\n  - gridcell "Active" [ref=e52]`),
  ['gridcell "Alice Smith" [e51]', 'gridcell "Active" [e52]'],
)
eq(
  'a container carrying MORE than its children survives',
  seen(`- row "Alice Smith — overdue" [ref=e50]:\n  - gridcell "Alice Smith" [ref=e51]`),
  ['row "Alice Smith — overdue" [e50]', 'gridcell "Alice Smith" [e51]'],
)
// Never dedup something you act on or must read.
eq(
  'a button wrapping its own label is not swallowed by it',
  seen(`- button "Save" [ref=e60]:\n  - text: Save`),
  ['button "Save" [e60]'],
)
eq(
  "an alert folds its message and doesn't repeat it",
  seen(`- alert [ref=e9]:\n  - listitem: Please provide a value`),
  ['alert "Please provide a value" [e9]'],
)

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-observe: all snapshot-parsing cases pass')
