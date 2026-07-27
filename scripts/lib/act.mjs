// act — perform an action and watch the page *through* it, in one call.
// Runs via `forge-cli.mjs act`.
//
// Why this exists: a driver acts in discrete turns, so its perception is
// point-in-time. `click` returns, then a separate `observe` looks — and
// anything that lived in between is gone. Toasts, `role=alert` flashes and
// spinners routinely last a few hundred ms, well under a model's decision
// latency, so the evidence that an action worked is the very thing most likely
// to be missed. The driver then hand-rolls a `click`-plus-`waitFor` in
// `run-code` to catch it — but only when it thought to, and it usually only
// learns the transient mattered after it's gone.
//
// `act` closes that gap by moving the watching inside the acting call. A
// MutationObserver is installed *before* the action and drained after, so a
// transient cannot slip between turns: there is no between. Both edges are
// recorded — a toast that appeared and vanished shows up as evidence even
// though nothing is on screen by the time the call returns.
//
// An observer beats sampling here. Polling at 10Hz can still miss a 50ms
// insert-then-remove; the observer fires on both edges by construction, and
// costs nothing while the page is idle.
//
// Then it settles (no requests in flight, and none for a quiet window) before
// reporting, so the view the driver reads is a stable page rather than a
// mid-render one.
//
// Usage:
//   forge-cli.mjs act -s=<name> click <ref> [options]
//   forge-cli.mjs act -s=<name> fill <ref> <value> [options]
//   forge-cli.mjs act -s=<name> press <ref> <key> [options]
//   forge-cli.mjs act -s=<name> select <ref> <value> [options]
//   forge-cli.mjs act -s=<name> hover|check|uncheck <ref> [options]
//   forge-cli.mjs act -s=<name> goto <url> [options]
//
//   -s=<name> / --session=<name>   the playwright-cli session (required)
//   --quiet=<ms>                   quiet window that counts as settled (500)
//   --timeout=<ms>                 give up settling after this (8000)
//   --raw                          also print the transient log's raw entries
//
// Gate candidates: there is deliberately NO way to declare an expected outcome.
// A gate is only ever derived from what was observed after the action, and it
// is offered as a shortlist rather than a pick.
//
// Both properties are the same guard against the same failure. Nominating a
// signal in advance drags the outcome toward the prediction — and even when the
// predicted thing does happen, it is not necessarily the BEST thing to wait on,
// so a satisfied prediction quietly forecloses a better gate that was sitting
// right there in the diff. Measured on a real drive: the one declaration that
// passed named a signal the observed ranking would have picked anyway (it added
// nothing), while the one that failed reported a violation on a correct action
// and its wrong verdict then suppressed the real observation entirely.
//
// So the choice is made once, late, by whoever has the context: candidates are
// ranked by durability (live region → navigation → landmark → other) and the
// curator picks knowing what the snippet is for. An empty shortlist is a real
// answer — better a snippet with no gate and a caveat than a confident wrong one.
//
// What survives from the contract idea is the part that needs no prediction:
// `NO OBSERVABLE EFFECT` is reported structurally whenever nothing measurable
// changed, which is the engine's "K consecutive no-effect actions" escalation
// trigger and cannot bias anything, because it names no signal.
//
// Refs are the ones `observe` prints — resolved via Playwright's `aria-ref`
// selector engine — so the two verbs are interchangeable in the same session.
// The settled view is taken through `observe --live` rather than snapshotted
// in-page, which keeps ref numbering and the change-marker baseline shared
// between them.
//
// Exit codes:
//   0  acted
//   2  usage error
//   3  the action itself failed (playwright error passed through)

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRedactMap, redact } from './pw.mjs'

const FORGE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'forge-cli.mjs')

// Actions that take a ref plus a value, vs a ref alone, vs neither.
const WITH_VALUE = new Set(['fill', 'press', 'select', 'type'])
const REF_ONLY = new Set(['click', 'hover', 'check', 'uncheck', 'focus', 'dblclick'])
const NO_REF = new Set(['goto'])

export function parseArgs(argv) {
  const opts = {
    session: null, action: null, ref: null, value: null,
    quiet: 500, timeout: 8000, raw: false,
    unknownFlags: [],
  }
  const positional = []
  for (const a of argv) {
    if (a === '--raw') opts.raw = true
    else if (a.startsWith('--quiet=')) opts.quiet = Number(a.slice('--quiet='.length))
    else if (a.startsWith('--timeout=')) opts.timeout = Number(a.slice('--timeout='.length))
    else if (a.startsWith('--session=')) opts.session = a.slice('--session='.length)
    else if (a.startsWith('-s=')) opts.session = a.slice('-s='.length)
    // Noted rather than ignored: a flag `act` doesn't have was silently dropped
    // in a real drive (`--json`, reached for when the driver couldn't see its
    // own verdict), so it looked honoured and the driver drew a false
    // conclusion. Note it on stderr and carry on — forge-pw's near-miss
    // treatment — rather than failing and costing a round.
    else if (a.startsWith('--')) opts.unknownFlags.push(a)
    else positional.push(a)
  }
  opts.action = positional[0] ?? null
  if (opts.action && NO_REF.has(opts.action)) {
    opts.value = positional[1] ?? null
  } else {
    opts.ref = positional[1] ?? null
    opts.value = positional[2] ?? null
  }
  return opts
}

// The in-page half: install the observer, act, drain, settle. Returned as one
// `async page => {...}` body for run-code. Values are JSON-embedded so quoting
// and shell-expansion hazards can't reach the page.
export function buildBody({ action, ref, value, quiet, timeout }) {
  const target = ref ? `page.locator(${JSON.stringify(`aria-ref=${ref}`)})` : 'page'
  let call
  if (action === 'goto') call = `await page.goto(${JSON.stringify(value)})`
  else if (action === 'fill') call = `await ${target}.fill(${JSON.stringify(value ?? '')})`
  else if (action === 'type') call = `await ${target}.pressSequentially(${JSON.stringify(value ?? '')})`
  else if (action === 'press') call = `await ${target}.press(${JSON.stringify(value ?? '')})`
  else if (action === 'select') call = `await ${target}.selectOption(${JSON.stringify(value ?? '')})`
  else call = `await ${target}.${action}()`

  return `async page => {
  const startUrl = page.url()
  // Network activity, tracked for the life of THIS call — the deterministic
  // half of "is the page worth looking at yet?".
  let inflight = 0, lastActivity = Date.now()
  const onReq = () => { inflight++; lastActivity = Date.now() }
  const onEnd = () => { inflight = Math.max(0, inflight - 1); lastActivity = Date.now() }
  page.on('request', onReq); page.on('requestfinished', onEnd); page.on('requestfailed', onEnd)

  // Install BEFORE acting, so an instant toast is already being watched.
  const install = () => page.evaluate(() => {
    if (window.__forgeLog) return
    window.__forgeLog = []
    // A framework re-render inserts whole subtrees, and a container's
    // textContent is every descendant's text concatenated — on an SPA or a data
    // grid that would arrive as the entire page in one entry, burying the
    // actual message. So don't describe containers: descend through them and
    // keep the leaf-ish nodes inside (a validation message, a toast, a badge).
    // Dropping a container outright would take its leaves with it — the cart
    // badge that re-rendered along with its header is exactly the signal worth
    // keeping. Whatever this over-collects is filtered again on the way out:
    // anything already in the settled view is dropped there.
    const MAX_TEXT = 160
    const MAX_NODES = 40
    const MAX_DEPTH = 6
    // What separates a message from a container is whether the node carries its
    // OWN text — its direct text-node children — not whether it has element
    // children and not how long its combined text is. Both weaker tests fail on
    // real markup: a wrapper's concatenated text can sit under any length bar
    // you pick, and a validation message routinely holds a dismiss button, so
    // "has children" would classify the message itself as a container.
    const ownText = n => Array.from(n.childNodes)
      .filter(c => c.nodeType === 3)
      .map(c => c.textContent)
      .join(' ').trim().replace(/\\s+/g, ' ')
    const leafish = n => {
      const label = n.getAttribute('aria-label')
      const explicit = n.getAttribute('role')
      // Own text first, then a self-naming widget (aria-label / explicit role),
      // which is worth recording even when its text lives in descendants.
      const text = ownText(n) || ((label || explicit) ? (label || n.textContent || '').trim().replace(/\\s+/g, ' ') : '')
      if (!text || text.length > MAX_TEXT) return null
      return { role: explicit || n.tagName.toLowerCase(), name: text.slice(0, 100) }
    }
    const collect = (n, out, depth) => {
      if (n.nodeType !== 1 || out.length >= MAX_NODES || depth > MAX_DEPTH) return out
      const d = leafish(n)
      if (d) out.push(d)
      else for (const c of n.children) collect(c, out, depth + 1)
      return out
    }
    const obs = new MutationObserver(ms => {
      for (const m of ms) {
        for (const n of m.addedNodes) for (const d of collect(n, [], 0)) window.__forgeLog.push({ edge: 'appeared', ...d })
        for (const n of m.removedNodes) for (const d of collect(n, [], 0)) window.__forgeLog.push({ edge: 'gone', ...d })
      }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    window.__forgeObs = obs
  }).catch(() => {})
  await install()

  let error = null
  try { ${call} } catch (e) { error = String(e && e.message || e) }

  // Settle: nothing in flight, and nothing for a quiet window — bounded, so a
  // perpetually chatty page (polling, websockets) can't hang the call.
  const began = Date.now()
  let settled = false
  while (Date.now() - began < ${timeout}) {
    if (inflight === 0 && Date.now() - lastActivity >= ${quiet}) { settled = true; break }
    await page.waitForTimeout(50)
  }
  const settleMs = Date.now() - began
  page.off('request', onReq); page.off('requestfinished', onEnd); page.off('requestfailed', onEnd)

  // A navigation tears the in-page observer down with the document, so any log
  // is unreliable — and navigation is a loud signal the diff shows anyway.
  const navigated = page.url() !== startUrl
  let transients = []
  if (!navigated) {
    transients = await page.evaluate(() => {
      const log = window.__forgeLog || []
      if (window.__forgeObs) window.__forgeObs.disconnect()
      delete window.__forgeObs; delete window.__forgeLog
      return log
    }).catch(() => [])
  }
  return JSON.stringify({ error, settled, settleMs, navigated, url: page.url(), transients })
}`
}

// Accessible names present in observe's settled view, so the log can report
// only what that view does NOT already carry.
export function viewNames(viewBody) {
  const names = new Set()
  for (const line of viewBody.split('\n')) {
    const m = /^[+~\-\s]*(?:\[[^\]]*\]\s+)?[a-zA-Z-]+\s+"((?:[^"\\]|\\.)*)"/.exec(line)
    if (m) names.add(m[1].replace(/\\(["\\])/g, '$1'))
  }
  return names
}

const LOG_CAP = 12

// Split the mutation log into the two things a later observe would miss.
//
//   transient — appeared AND vanished inside the window. Structurally
//               invisible to any point-in-time look, however well timed.
//   unlisted  — appeared and is still on the page, but observe's filtered view
//               doesn't carry it. Its role isn't interactable or a signal, so
//               the view drops it — yet it's often the very thing that explains
//               the outcome (a validation message rendered as a heading, a
//               status line rendered as a paragraph).
//
// Anything appearing in the settled view is deliberately omitted: the diff
// already reports it, and repeating it would bury the signal.
export function partitionLog(log, names = new Set()) {
  const gone = new Set(log.filter(e => e.edge === 'gone').map(e => `${e.role}|${e.name}`))
  const seen = new Set()
  const transient = []
  const unlisted = []
  for (const e of log) {
    if (e.edge !== 'appeared') continue
    const key = `${e.role}|${e.name}`
    if (seen.has(key)) continue
    seen.add(key)
    if (gone.has(key)) transient.push({ role: e.role, name: e.name })
    else if (!names.has(e.name)) unlisted.push({ role: e.role, name: e.name })
  }
  return { transient: transient.slice(0, LOG_CAP), unlisted: unlisted.slice(0, LOG_CAP) }
}

// Parse observe's lines back into expectation candidates, so a declared
// outcome can be matched against what stuck as well as what flashed.
//   `+ [e12] alert "Saved"` → { role: 'alert', name: 'Saved' }
//
// `all` widens this to every element rather than only the marked ones. That is
// the correct reading after a navigation: observe re-baselines to an UNMARKED
// full view, so nothing carries a `+` — yet the whole page just appeared, and
// an expectation about the destination ("a button named Add to cart") is
// exactly what a driver wants to declare across a navigation.
export function parseObserveChanges(text, all = false) {
  const marked = /^([+~-])\s+(?:\[[^\]]*\]\s+)?([a-zA-Z-]+)\s+"((?:[^"\\]|\\.)*)"/
  const any = /^[+~\-\s]*(?:\[[^\]]*\]\s+)?([a-zA-Z-]+)\s+"((?:[^"\\]|\\.)*)"/
  const out = []
  for (const line of text.split('\n')) {
    const m = all ? any.exec(line) : marked.exec(line)
    if (!m) continue
    const [role, name] = all ? [m[1], m[2]] : [m[2], m[3]]
    out.push({ role, name: name.replace(/\\(["\\])/g, '$1') })
  }
  return out
}

// observe re-baselines to a plain, unmarked full view on a navigation or a
// first look — `full (navigation)`, `full (baseline)`, `full (forced)` — as
// distinct from `full+marks (N changed)` / `diff (N changes)`, which do mark.
export function isBaselineView(header) {
  return /\|\s*full \(/.test(header)
}

// The Playwright equivalent of the action, for the trace.
//
// This is load-bearing beyond readability: the curator authors snippets from
// the driver's echoed code, and a spec is composed from it. An `aria-ref` is a
// per-snapshot handle that means nothing in a saved spec, so the ref is
// resolved to a durable semantic locator first (playwright-cli's
// `generate-locator`, the same resolution its own echoes use). If that fails,
// the raw ref is echoed with a marker rather than passing a stale handle off as
// durable — the curator can then see it needs a real selector.
export function locatorFor(session, ref) {
  if (!ref) return null
  const r = spawnSync(process.execPath, [FORGE_CLI, 'pw', '--json', `-s=${session}`, 'generate-locator', ref], { encoding: 'utf8' })
  if (r.status !== 0) return null
  try {
    // `pw --json` returns {"result": "locator('…')"} — the locator is already a
    // plain string here, unlike run-code's payload, which is itself JSON.
    const out = JSON.parse(r.stdout)
    return typeof out.result === 'string' && out.result.trim() ? out.result.trim() : null
  } catch { return null }
}

// `locator` is the resolved semantic locator, or null when resolution failed —
// in which case the raw ref is echoed with a trailing marker so the curator can
// see the selector still needs a durable form, rather than a per-snapshot
// handle being passed off as one.
export function playwrightCode({ action, value, ref }, locator) {
  const target = locator ? `page.${locator}` : `page.locator('aria-ref=${ref}')`
  const arg = value == null ? '' : JSON.stringify(value)
  let line
  switch (action) {
    case 'goto': line = `await page.goto(${arg});`; break
    case 'fill': line = `await ${target}.fill(${arg});`; break
    case 'type': line = `await ${target}.pressSequentially(${arg});`; break
    case 'press': line = `await ${target}.press(${arg});`; break
    case 'select': line = `await ${target}.selectOption(${arg});`; break
    default: line = `await ${target}.${action}();`
  }
  return locator || action === 'goto' ? line : `${line}  // unresolved ref — needs a durable selector`
}

// --- postconditions: the wait a snippet inherits ---
//
// The signal the driver used to know an action worked is exactly the signal a
// durable snippet should wait on, so the two are one decision made once. Left
// implicit, it's lost: `act` settles at runtime, which is invisible to the
// composed snippet — the curator would author a bare `.click()` with no gate,
// and the snippet races on the next run.
//
// Durability is the whole point, so candidates are ranked by how well a signal
// survives the same flow running with different inputs. Instance content (a
// product's name, a price, an image caption) verifies this run and breaks the
// next one, so it ranks last and is excluded outright where the role gives it
// away.
const LIVE_ROLES = new Set(['alert', 'status', 'alertdialog'])
const LANDMARK_ROLES = new Set(['button', 'link', 'tab', 'heading', 'menuitem', 'menubar', 'navigation'])
const CONTENT_ROLES = new Set(['figure', 'img', 'image', 'paragraph', 'cell', 'row', 'gridcell', 'listitem', 'p', 'span', 'div'])
const ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'button', 'checkbox', 'columnheader', 'combobox', 'dialog', 'grid',
  'gridcell', 'heading', 'link', 'list', 'listbox', 'listitem', 'menu', 'menubar', 'menuitem',
  'navigation', 'option', 'progressbar', 'radio', 'row', 'searchbox', 'slider', 'spinbutton',
  'status', 'switch', 'tab', 'table', 'tabpanel', 'textbox', 'tooltip', 'treeitem',
])

// Path segments that vary per run — an id baked into a URL assertion makes it
// pass once and fail forever after.
//
// The last clause is the general catch: any long unbroken alphanumeric run that
// contains a digit is an opaque identifier, whatever the encoding. Enumerating
// formats does not hold — a real ULID (`01KYGVP859P19531MVQQ0Q4RHP`) slipped
// through a digits/hex/UUID check and hard-coded one product into a suggested
// wait. Real path words stay clear of it: they're shorter, or hyphenated or
// dotted (`sauce-labs-backpack`, `inventory.html`), or carry no digit at all.
export function looksDynamicId(seg) {
  if (/^\d+$/.test(seg)) return true // 42
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return true // uuid
  if (/^[0-9a-f]{12,}$/i.test(seg)) return true // long hex
  return seg.length >= 16 && /^[0-9A-Za-z]+$/.test(seg) && /\d/.test(seg) // ulid, nanoid, opaque
}

// A gate's timeout, grounded in what this action actually took to settle rather
// than a guessed constant: three times the observed settle, floored at 5s. A
// page that took 5s to quiet down deserves more headroom than one that took
// 500ms, and the run just measured which it is.
export function gateTimeout(settleMs = 0) {
  return Math.max(5000, Math.ceil((settleMs * 3) / 1000) * 1000)
}

export function urlAssertion(url, timeoutMs) {
  let u
  try { u = new URL(url) } catch { return null }
  const segs = u.pathname.split('/').filter(Boolean)
  if (!segs.length) return null // the root is not a distinctive destination
  // Every `/` is escaped — the result is a regex LITERAL, so an unescaped
  // separator would close it early and the emitted line wouldn't parse.
  const pattern = segs
    .map(s => (looksDynamicId(s) ? '[^\\/]+' : s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')))
    .join('\\/')
  const t = timeoutMs ? `, { timeout: ${timeoutMs} }` : ''
  return `await expect(page).toHaveURL(/\\/${pattern}\\/?$/${t});`
}

// The Playwright wait for one observed signal. `role` may be a tag name (the
// mutation log reports tags for unlabelled nodes), so headings and non-ARIA
// tags fall back to forms that actually exist.
export function assertionFor({ role, name }, timeoutMs) {
  const r = String(role || '').toLowerCase()
  const nm = JSON.stringify(name)
  const t = timeoutMs ? `{ timeout: ${timeoutMs} }` : ''
  if (/^h[1-6]$/.test(r)) return `await expect(page.getByRole('heading', { name: ${nm} })).toBeVisible(${t});`
  if (ARIA_ROLES.has(r)) return `await expect(page.getByRole('${r}', { name: ${nm} })).toBeVisible(${t});`
  return `await expect(page.getByText(${nm})).toBeVisible(${t});`
}

// The gate candidates that ACTUALLY occurred, best-first — never a single pick.
//
// A shortlist rather than a verdict, because the choice needs context this
// function does not have: what the snippet is FOR, which values will be
// parameterised, whether the flow is reused across products or users. Ranking
// is a hint from role alone; the curator decides. Offering one pick reads as a
// decision already made, and hides that there was a trade-off at all.
//
// Bounded to observation by construction — a gate cannot be proposed for
// something that never happened. That is the whole guarantee: no gate is ever
// nominated in advance, so nothing biases the action toward its own prediction,
// and a signal that merely COULD have appeared never becomes a wait.
const MAX_CANDIDATES = 3

export function gateCandidates(observed, { navigated, url, settleMs } = {}) {
  const timeoutMs = gateTimeout(settleMs)
  const usable = observed.filter(c => c.name && !CONTENT_ROLES.has(String(c.role).toLowerCase()))
  const seen = new Set()
  const tiered = []
  const push = (c, tier) => {
    const key = c.kind === 'url' ? 'url' : `${c.role}|${c.name}`
    if (seen.has(key)) return
    seen.add(key)
    tiered.push({ ...c, tier, timeoutMs })
  }
  for (const c of usable) if (LIVE_ROLES.has(String(c.role).toLowerCase())) push({ kind: 'role', ...c }, 'live region')
  if (navigated && url) {
    const a = urlAssertion(url, timeoutMs)
    if (a) push({ kind: 'url', assertion: a }, 'navigation')
  }
  for (const c of usable) {
    const r = String(c.role).toLowerCase()
    if (LANDMARK_ROLES.has(r) || /^h[1-6]$/.test(r)) push({ kind: 'role', ...c }, 'landmark')
  }
  for (const c of usable) push({ kind: 'role', ...c }, 'other')
  return tiered.slice(0, MAX_CANDIDATES)
}

export function candidateLine(c) {
  return c.kind === 'url' ? c.assertion : assertionFor(c, c.timeoutMs)
}

function runCode(session, body) {
  const r = spawnSync(process.execPath, [FORGE_CLI, 'pw', '--json', `-s=${session}`, 'run-code', body], { encoding: 'utf8' })
  if (r.status !== 0) return { ok: false, stderr: r.stderr || r.stdout || '' }
  // pw --json wraps the return value as {"result": "<json-string>"}; the inner
  // payload is a JSON string, so it unwraps twice.
  try {
    const outer = JSON.parse(r.stdout)
    if (outer.isError) return { ok: false, stderr: outer.error || 'run-code reported an error' }
    let inner = outer.result
    if (typeof inner === 'string') inner = JSON.parse(inner)
    if (typeof inner === 'string') inner = JSON.parse(inner)
    return { ok: true, data: inner }
  } catch (e) {
    return { ok: false, stderr: `act: could not parse run-code output — ${e.message}\n${r.stdout.slice(0, 400)}` }
  }
}

export async function main(args) {
  const opts = parseArgs(args)
  if (!opts.session || !opts.action) {
    console.error('act: usage: forge-cli.mjs act -s=<name> <click|fill|press|select|hover|check|goto> [<ref>] [<value>] [--quiet=<ms>] [--timeout=<ms>] [--raw]')
    process.exit(2)
  }
  const known = WITH_VALUE.has(opts.action) || REF_ONLY.has(opts.action) || NO_REF.has(opts.action)
  if (!known) {
    console.error(`act: unknown action '${opts.action}' — expected one of: ${[...REF_ONLY, ...WITH_VALUE, ...NO_REF].sort().join(', ')}`)
    console.error("act: for anything outside this set, drive it with `pw run-code` (act covers the common verbs, not the whole surface)")
    process.exit(2)
  }
  if (!NO_REF.has(opts.action) && !opts.ref) {
    console.error(`act: '${opts.action}' needs a ref — e.g. forge-cli.mjs act -s=${opts.session} ${opts.action} e12`)
    process.exit(2)
  }
  if (WITH_VALUE.has(opts.action) && opts.value == null) {
    console.error(`act: '${opts.action}' needs a value — e.g. forge-cli.mjs act -s=${opts.session} ${opts.action} ${opts.ref} "text"`)
    process.exit(2)
  }
  // A removed flag is worth naming rather than filing under "unknown": drivers
  // reached for it, and the reason it's gone is the point.
  for (const f of opts.unknownFlags.filter(f => /^--expect/.test(f))) {
    console.error(`act: '${f}' no longer exists — act never predicts an outcome. It reports the gate candidates it actually observed; pick one from the block it prints.`)
  }
  for (const f of opts.unknownFlags.filter(f => !/^--expect/.test(f))) {
    console.error(`act: '${f}' is not an act flag — ignored. act prints a summary already; read its output whole rather than piping it through \`tail\`.`)
  }

  // Resolve the semantic locator BEFORE acting — after the action the ref may
  // be stale, or the element gone.
  const locator = NO_REF.has(opts.action) ? null : locatorFor(opts.session, opts.ref)

  const res = runCode(opts.session, buildBody(opts))
  if (!res.ok) {
    process.stderr.write(res.stderr.endsWith('\n') ? res.stderr : `${res.stderr}\n`)
    console.error(`act: action failed (session ${opts.session})`)
    process.exit(3)
  }
  const { error, settled, settleMs, navigated, transients: log } = res.data

  // Settled view via observe, so refs and the change-marker baseline stay
  // shared with whatever the driver ran before this.
  const obs = spawnSync(process.execPath, [FORGE_CLI, 'observe', '--live', `-s=${opts.session}`], { encoding: 'utf8' })
  const view = (obs.stdout || '').trim()
  const [header, ...rest] = view.split('\n')
  const viewBody = rest.join('\n')
  // A navigation (or any re-baseline) means the whole view is new, so every
  // element counts as a change for matching purposes.
  const rebaselined = navigated || isBaselineView(header)
  const changes = parseObserveChanges(viewBody, rebaselined)
  const { transient, unlisted } = partitionLog(log || [], viewNames(viewBody))

  const candidates = gateCandidates([...transient, ...unlisted, ...changes], { navigated, url: res.data.url, settleMs })
  // Structural, undeclared: nothing measurable happened. This is the escalation
  // trigger that survives dropping prospective expectations — the engine's
  // "K consecutive no-effect actions" needs no prediction to detect, so it
  // can't bias the action toward an outcome the way declaring one did.
  const noEffect = !navigated && transient.length === 0 && unlisted.length === 0 && changes.length === 0

  // ORDER IS LOAD-BEARING: longest first, most important last.
  //
  // Drivers habitually pipe a command through `tail -N`, which keeps the END of
  // the output. With the summary printed first it was the part that got cut —
  // observed costing real damage: a driver never saw its own action's result,
  // re-ran an add-to-cart, and double-added the item; and the echo block was
  // truncated out of the transcript, so the curator could not read the code it
  // authors snippets from and had to reconstruct locators from the view.
  //
  // So the bulky settled view goes first (it is the most re-derivable part — one
  // `observe` brings it back), and the verdict plus the trace echo go last,
  // where `tail` preserves them.
  const map = buildRedactMap()
  console.log(view || '# act: no view (observe returned nothing)')

  if (transient.length || unlisted.length) {
    console.log('# seen during the action, and NOT in the settled view above:')
    for (const t of transient) console.log(`  ! ${t.role} ${JSON.stringify(t.name)}   (gone by now)`)
    for (const u of unlisted) console.log(`  + ${u.role} ${JSON.stringify(u.name)}`)
  } else if (navigated) {
    console.log('# not tracked across a navigation (the diff above carries the change)')
  }
  if (opts.raw && log?.length) {
    console.log('# raw mutation log:')
    for (const e of log) console.log(`  ${e.edge === 'appeared' ? '+' : '-'} ${e.role} ${JSON.stringify(e.name)}`)
  }

  const bits = [
    `session=${opts.session}`,
    `${opts.action}${opts.ref ? ` ${opts.ref}` : ''}`,
    settled ? `settled in ${settleMs}ms` : `UNSETTLED after ${settleMs}ms`,
  ]
  if (navigated) bits.push('navigated')
  if (error) bits.push(`action error: ${error}`)
  if (noEffect) bits.push('NO OBSERVABLE EFFECT')
  console.log(`# act: ${bits.join(' | ')}`)

  // The trace echo, in the shape read-trace already extracts. Redacted on the
  // same terms as forge-pw's own output: `act` prints this line itself, so an
  // env-sourced value would otherwise reach the transcript in the clear.
  const code = playwrightCode(opts, locator)
  console.log('### Ran Playwright code')
  console.log('```js')
  console.log(redact(code, map))
  // Candidates are comments, never code: none of them ran. `act` settled and
  // watched, but it did not evaluate these as assertions, and emitting them as
  // code would claim a check that never happened.
  if (candidates.length) {
    console.log(`// forge: gate candidates — all OBSERVED after this action; pick one for the snippet:`)
    candidates.forEach((c, i) => console.log(`//   ${i + 1}. [${c.tier}] ${redact(candidateLine(c), map)}`))
  } else if (noEffect) {
    console.log('// forge: no gate candidate — nothing observable changed after this action.')
  } else {
    console.log('// forge: no durable gate candidate — what changed was instance content only.')
  }
  console.log('```')

  if (error) process.exit(3)
  process.exit(0)
}
