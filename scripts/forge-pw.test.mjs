#!/usr/bin/env node
// forge-pw.test.mjs — the near-miss alias map for the playwright-cli wrapper.
// applyAliases is pure argv-rewriting (no spawn, no playwright-cli needed), so
// it's unit-tested by import. Pins the two slips seen repeatedly in real
// drives — the `navigate` verb and screenshot's `--path` flag — and, just as
// importantly, that everything else passes through untouched.
//
// Run: node scripts/forge-pw.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { applyAliases } from './lib/pw.mjs'

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`)
}

// Verb alias: `navigate` → `goto`, even behind a leading global flag.
eq('navigate → goto', applyAliases(['navigate', 'about:blank']), ['goto', 'about:blank'])
eq(
  'navigate → goto behind -s= session flag',
  applyAliases(['-s=demo', 'navigate', 'https://example.com']),
  ['-s=demo', 'goto', 'https://example.com'],
)

// Flag alias: screenshot --path → --filename, both separated and = forms.
eq(
  'screenshot --path <v> → --filename <v>',
  applyAliases(['-s=demo', 'screenshot', '--path', 'shot.png']),
  ['-s=demo', 'screenshot', '--filename', 'shot.png'],
)
eq(
  'screenshot --path=<v> → --filename=<v>',
  applyAliases(['screenshot', '--path=shot.png']),
  ['screenshot', '--filename=shot.png'],
)

// Scope: --path is only rewritten for screenshot, not other verbs.
eq(
  '--path left alone for a non-screenshot verb',
  applyAliases(['goto', '--path', '/x']),
  ['goto', '--path', '/x'],
)

// Pass-through: a correct command is returned unchanged.
eq('goto passes through', applyAliases(['-s=demo', 'goto', 'about:blank']), ['-s=demo', 'goto', 'about:blank'])
eq('click passes through', applyAliases(['-s=demo', 'click', 'e3']), ['-s=demo', 'click', 'e3'])

// Degenerate input: no verb token (only flags) is safe.
eq('all-flags input is untouched', applyAliases(['--json']), ['--json'])
eq('empty input is untouched', applyAliases([]), [])

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-pw: all alias cases pass')
