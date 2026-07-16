#!/usr/bin/env node
// forge-lint-spec.test.mjs — the pre-verify hang-footgun scanner.
// lintSpec is pure text analysis, so the detection matrix is unit-tested by
// import; the verb's exit-code contract (1 on findings, 0 clean, 2 on a bad
// path, 0 on --help) is pinned end-to-end through the real CLI.
//
// Run: node scripts/forge-lint-spec.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintSpec } from './lib/lint-spec.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'forge-cli.mjs')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) return
  failures++
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}
const kinds = (fs) => fs.map((f) => f.kind).sort()
const methods = (fs) => fs.map((f) => f.method).sort()

// --- unit: detection matrix --------------------------------------------

const SPEC = `import { test, expect } from '@playwright/test'
test('flow', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto(process.env.BASE_URL!)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.getByLabel('User').fill('alice', { timeout: 5000 })
  await page.waitForResponse('**/api/x')
  await page.waitForTimeout(500)
  await page.locator('#ok').waitFor({ state: 'visible', timeout: 10000 })
  await expect(page.getByText('Welcome')).toBeVisible()
})
`
{
  const f = lintSpec(SPEC)
  check('finds exactly the three footguns', f.length === 3, `got ${f.length}: ${JSON.stringify(methods(f))}`)
  check('flags the untimed click', f.some((x) => x.method === 'click' && x.kind === 'untimed-action'))
  check('flags the untimed waitForResponse', f.some((x) => x.method === 'waitForResponse' && x.kind === 'untimed-wait'))
  check('flags the fixed waitForTimeout', f.some((x) => x.method === 'waitForTimeout' && x.kind === 'fixed-settle'))
  check('timed fill is NOT flagged', !f.some((x) => x.method === 'fill'))
  check('timed waitFor is NOT flagged', !f.some((x) => x.method === 'waitFor'))
  check('goto is NOT flagged', !f.some((x) => x.method === 'goto'))
  check('toBeVisible assertion is NOT flagged', !f.some((x) => x.method === 'toBeVisible'))
  check('test.setTimeout is NOT flagged', !f.some((x) => x.method === 'setTimeout'))
  check('findings carry line numbers', f.every((x) => x.line > 0))
}

// A clean spec (every action timed, waits gated) yields nothing.
{
  const clean = `await page.getByRole('button').click({ timeout: 5000 })
await page.locator('#x').fill('v', { timeout: 5000 })
await page.waitForResponse('**/api', { timeout: 15000 })`
  check('fully-timed spec is clean', lintSpec(clean).length === 0, JSON.stringify(lintSpec(clean)))
}

// A `)` inside a string argument must not truncate the call (so a following
// timeoutless call is still seen, and the string call is judged correctly).
{
  const tricky = `await page.getByText('done)').click()`
  const f = lintSpec(tricky)
  check('string-paren: click still flagged', f.length === 1 && f[0].method === 'click', JSON.stringify(f))
}

// A timeout spread across multiple lines of the option object is honored.
{
  const multiline = `await page.locator('#x').click({
  force: true,
  timeout: 8000,
})`
  check('multi-line timeout is honored', lintSpec(multiline).length === 0, JSON.stringify(lintSpec(multiline)))
}

// --- e2e: the verb through the real CLI --------------------------------

const dir = mkdtempSync(join(tmpdir(), 'forge-lint-spec-test-'))
function run(args) {
  return spawnSync(process.execPath, [CLI, 'lint-spec', ...args], { encoding: 'utf8' })
}
try {
  const dirty = join(dir, 'dirty.spec.ts')
  const clean = join(dir, 'clean.spec.ts')
  writeFileSync(dirty, SPEC)
  writeFileSync(clean, `await page.getByRole('b').click({ timeout: 5000 })\n`)

  {
    const r = run([dirty])
    check('findings → exit 1', r.status === 1, `status ${r.status}`)
    check('findings named on stderr', r.stderr.includes('untimed-action') && r.stderr.includes('fixed-settle'), r.stderr)
  }
  {
    const r = run([clean])
    check('clean → exit 0', r.status === 0, `status ${r.status}`)
  }
  {
    const r = run([dirty, '--json'])
    check('--json → exit 1', r.status === 1, `status ${r.status}`)
    const parsed = JSON.parse(r.stdout)
    check('--json shape', parsed.count === 3 && Array.isArray(parsed.findings), r.stdout)
  }
  {
    const r = run(['--help'])
    check('--help → exit 0', r.status === 0, `status ${r.status}`)
    check('--help prints usage', r.stdout.includes('usage: forge-cli.mjs lint-spec'), r.stdout)
  }
  {
    const r = run([join(dir, 'nope.spec.ts')])
    check('missing file → exit 2', r.status === 2, `status ${r.status}`)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('forge-lint-spec: all cases pass')
