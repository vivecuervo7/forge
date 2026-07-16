// lint-spec — flag a composed spec's untimed actions/waits and fixed settles.
//
// The hang footgun behind slow cold-verify rounds. Forge's scaffolded config
// sets no actionTimeout, so
// Playwright's default (0 = no per-action cap) applies. An untimed action on
// a locator that never becomes actionable doesn't fail fast — it pends until
// the whole test times out (the composed specs set a long test.setTimeout),
// so one wrong selector burns the full budget and reads as a mysterious
// "Test timeout exceeded" rather than "this click never resolved". A fixed
// waitForTimeout is the other side of the same coin: it races headless speed
// instead of gating on the state it's actually waiting for. This flags both
// by file:line before a single browser launches — cheaper than discovering
// them one 120s cold-run at a time.
//
// Advisory, not a gate: findings are guidance for the compose/self-fix step,
// not a pass/fail verdict. run-spec prints them as a preamble; the driver can
// also run it directly.
//
// Usage:
//   forge-cli.mjs lint-spec <path-to-spec.ts> [--json]
//
// Exit codes:
//   0  clean — no findings
//   1  findings printed (advisory; not a spec failure)
//   2  usage error / file unreadable

import { readFileSync } from 'node:fs'

// Auto-waiting actions: each waits for actionability and, with actionTimeout
// unset, pends to the test timeout if the target never gets there.
const ACTION_METHODS = new Set([
  'click', 'dblclick', 'fill', 'press', 'pressSequentially', 'type', 'hover',
  'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'tap',
  'focus', 'clear', 'dragTo', 'scrollIntoViewIfNeeded', 'dispatchEvent',
])

// Explicit waits: an unmet condition pends to the test timeout without a cap.
const WAIT_METHODS = new Set([
  'waitFor', 'waitForSelector', 'waitForResponse', 'waitForRequest',
  'waitForFunction', 'waitForEvent', 'waitForURL', 'waitForLoadState',
])

// From the index of an opening `(`, return the substring between it and its
// matching `)`, respecting string literals so a `)` inside a string doesn't
// close the call early. Falls back to the remainder if unbalanced.
function callArgs(text, openIdx) {
  let depth = 0
  let quote = null
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return text.slice(openIdx + 1, i)
    }
  }
  return text.slice(openIdx + 1)
}

const hasTimeout = (args) => /\btimeout\s*:/.test(args)
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length
const lineText = (text, line) => (text.split('\n')[line - 1] ?? '').trim()

// Pure: scan spec source, return findings sorted by line. Exported for tests
// and for run-spec's preamble.
export function lintSpec(text) {
  const findings = []
  const re = /\.(\w+)\s*\(/g
  let m
  while ((m = re.exec(text)) !== null) {
    const method = m[1]
    const openIdx = m.index + m[0].length - 1
    const isAction = ACTION_METHODS.has(method)
    const isWait = WAIT_METHODS.has(method)
    const isSettle = method === 'waitForTimeout'
    if (!isAction && !isWait && !isSettle) continue

    const line = lineOf(text, m.index)
    const excerpt = lineText(text, line)

    if (isSettle) {
      findings.push({
        line, method, kind: 'fixed-settle',
        message: 'fixed settle — prefer a state gate (waitForResponse / expect(locator).toBeVisible() / .waitFor({ state, timeout })) so it tracks the app, not headless speed',
        excerpt,
      })
      continue
    }
    if (hasTimeout(callArgs(text, openIdx))) continue
    findings.push({
      line, method,
      kind: isAction ? 'untimed-action' : 'untimed-wait',
      message: isAction
        ? `${method}() has no explicit { timeout } — with actionTimeout unset it pends to the test timeout if the target never becomes actionable`
        : `${method}() has no explicit timeout — an unmet wait pends to the test timeout`,
      excerpt,
    })
  }
  return findings.sort((a, b) => a.line - b.line)
}

const USAGE = [
  'usage: forge-cli.mjs lint-spec <path-to-spec.ts> [--json]',
  '',
  'Flags untimed locator actions/waits and fixed waitForTimeout settles —',
  'the hang footgun behind slow cold-verify rounds. Advisory: exit 1 means',
  'findings to weigh, not a spec failure.',
].join('\n')

export function main(args) {
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    console.log(USAGE)
    process.exit(0)
  }
  const json = args.includes('--json')
  const file = args.find((a) => !a.startsWith('-'))
  if (!file) {
    console.error('forge-lint-spec: missing <path-to-spec.ts>')
    console.error(USAGE)
    process.exit(2)
  }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    console.error(`forge-lint-spec: cannot read ${file}: ${err.message}`)
    process.exit(2)
  }

  const findings = lintSpec(text)
  if (json) {
    console.log(JSON.stringify({ file, findings, count: findings.length }))
    process.exit(findings.length ? 1 : 0)
  }
  if (findings.length === 0) {
    console.error(`forge-lint-spec: ${file} — clean (no untimed actions/waits or fixed settles)`)
    process.exit(0)
  }
  console.error(`forge-lint-spec: ${file} — ${findings.length} finding(s):`)
  for (const f of findings) {
    console.error(`  ${file}:${f.line}  [${f.kind}] ${f.message}`)
    if (f.excerpt) console.error(`      ↳ ${f.excerpt}`)
  }
  console.error('  (advisory — add an explicit timeout or a state gate; not a spec verdict)')
  process.exit(1)
}
