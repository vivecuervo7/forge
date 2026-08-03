// observe — deterministic perception primitive. Runs via
// `forge-cli.mjs observe`.
//
// Turns a playwright-cli ARIA snapshot (YAML) into the compact view a driver
// actually needs to pick the next action: the interactable, labelled surface
// plus error/alert signals — and, across calls, only the DIFF since the last
// observe. Pure transform, no browser, no model.
//
// Why: a raw snapshot re-pasted every turn is the dominant context cost of a
// browser-driving loop (and the dominant source of grounding noise). Most of a
// snapshot is structural `generic` wrappers and static `text:` the driver never
// acts on; and between actions almost nothing changes. Filtering + diffing cuts
// both — measured ~67% (filter) to ~82% (filter+diff) vs the full tree on a
// simple flow, with individual post-action turns dropping to a handful of tokens.
//
// Perception is deterministic; only judgement is probabilistic. This is the
// perception half — the driver still reasons over the result.
//
// Usage:
//   forge-cli.mjs observe --live -s=<name> [--diff] [--full] [--state=<path>]
//   forge-cli.mjs observe <snapshot.yaml> [--session=<name>] [--url=<url>] [--state=<path>] [--diff] [--full]
//   forge-cli.mjs observe -            (read snapshot YAML from stdin)
//
//   --live            take the snapshot itself (via forge-pw against the named
//                     session) and observe it in one call. The page URL is read
//                     from the snapshot echo, so navigation detection needs no
//                     --url from the caller. Snapshot lands in the project's
//                     forge/.observe/<session>.yaml (or the OS tmpdir when no
//                     forge root is findable).
//   -s=<name> / --session=<name>
//                     the playwright-cli session; also namespaces the diff
//                     state (default: "default"; required with --live)
//   --url=<url>       the page's current URL — used to detect navigation (a
//                     changed URL re-baselines; an in-page popup does not).
//                     Unnecessary with --live (self-detected).
//   --state=<path>    where prior state is kept (default: alongside the snapshot,
//                     `.forge-observe-<session>.json`)
//   --diff            aggressive: print only what changed since the last observe
//   --full            print a plain full view and reset the comparison baseline
//
// Filtering: two tests, because nodes earn their place two different ways.
// An **interactable** is kept because you can act on it — a ref is enough, so an
// icon button or a close `X` with no accessible name still shows up. Anything
// **else** is kept if it tells you something: a name or a value. Dropped are
// roles the platform marks as having no semantics at all (`generic`, `none`,
// bare `text`) and the snapshot's own `/url` / `/placeholder` metadata lines.
//
// This is deliberately NOT an allowlist of interesting roles. That is what it
// used to be, and it excluded whole categories of meaningful content by
// construction — a validation message rendered as a heading, a data grid's rows
// and cells, a status line as a paragraph. Measured on a real drive: a failed
// login showed the driver an unnamed dismiss button and not the error beside it,
// so it could see something went wrong but not what, and no amount of
// re-observing recovered it. Naming the noise instead of the signal means a role
// nobody anticipated still gets through.
//
// Signals fold in their descendant text (so an alert shows its message, not an
// empty name) and those descendants are then skipped rather than repeated.
// Containers whose name is merely their children's text run together are
// dropped in favour of the children — a grid row's accessible name is its cells
// concatenated, so keeping both reports every value twice. Long option runs
// collapse to one `option-list "first…last" = "N"` line (a big dropdown is noise
// the driver filters via its searchbox).
//
// Cost of showing non-interactive content, measured across 104 real snapshots:
// the view roughly doubles (10% → 23% of the raw snapshot), so it still
// compresses ~4x while ceasing to be selectively blind.
//
// Behaviour:
//   - Default → full filtered list with change markers (+ new / ~ changed /
//     blank unchanged, and - removed lines). Every element keeps its CURRENT
//     ref, so it's always safe to act on, while the markers still surface what
//     moved. Changes are keyed on role+name (NOT ref — refs are reassigned every
//     snapshot; and NOT id — ids are volatile, e.g. GUID-suffixed error ids).
//   - `--diff` → only the changed lines. Cheapest, but unchanged elements aren't
//     reshown and their refs shift per snapshot — use to confirm an action's
//     effect, not to pick up an unchanged element to click.
//   - Navigation (URL change, or high churn when no --url) → full view baseline.
//   - No prior state, or `--full` → plain full view (baseline).
//
// Exit codes:
//   0  observed (full or diff printed; --live on a blank page reports empty)
//   1  snapshot file unreadable, or empty in file mode (a broken handoff)
//   2  usage error
//   3  --live snapshot failed (forge-pw error passed through)

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findForgeRoot } from './common.mjs'

// Roles the driver can act on. No longer a filter — the view keeps informative
// content whatever its role — but still worth naming, because these are what a
// `[ref]` is worth acting on and what the option-run collapse keys off.
const INTERACTABLE = new Set([
  'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider',
  'searchbox', 'spinbutton', 'listbox',
])
const SIGNAL = new Set(['alert', 'alertdialog', 'status']) // errors / live regions

// Roles that are the platform saying "this has no semantic role" — layout
// divs and loose text runs. They may carry text, but a page's meaningful
// content is nearly always also present on a semantic ancestor or descendant,
// and on a real app these are the bulk: 140 of one page's 170 added lines were
// `generic` fragments like "Cmd" and "K". Excluded by name rather than by
// omission from an allowlist, so a role nobody thought of still gets through.
const ANONYMOUS = new Set(['generic', 'none', 'text', 'InlineTextBox'])

// Lines beginning `/` are the AI snapshot's metadata for the PARENT element
// (`/url` for a link's target, `/placeholder` for an input's hint) rather than
// elements in their own right. The flat parse can't attach them upward, and
// emitting them as elements is just wrong.
const isMeta = role => role.startsWith('/')
const FLAGS = ['checked', 'selected', 'disabled', 'expanded', 'pressed']

// churn ratio above which a diff is treated as a navigation (re-baseline)
const REBASELINE_CHURN = 0.6
const approxTok = s => Math.ceil((s?.length || 0) / 4)

function parseArgs(argv) {
  const opts = { session: 'default', sessionSet: false, state: null, full: false, diff: false, live: false, url: null, file: null }
  for (const a of argv) {
    if (a === '--full') opts.full = true
    else if (a === '--diff') opts.diff = true
    else if (a === '--live') opts.live = true
    else if (a.startsWith('--session=')) { opts.session = a.slice('--session='.length); opts.sessionSet = true }
    else if (a.startsWith('-s=')) { opts.session = a.slice('-s='.length); opts.sessionSet = true }
    else if (a.startsWith('--state=')) opts.state = a.slice('--state='.length)
    else if (a.startsWith('--url=')) opts.url = a.slice('--url='.length)
    else if (!a.startsWith('--')) opts.file = a
  }
  return opts
}

// Runs of options longer than this collapse to a single summary line — a big
// dropdown (e.g. ~250 countries) is noise the driver filters via its searchbox.
const OPTION_CAP = 8

// One YAML snapshot line -> a node, or null if it isn't an element line.
const LINE = /^(\s*)-\s+([^\s"[:]+)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s*\[[^\]]*\])*)\s*(?::\s*(.*?))?\s*$/

// Playwright emits YAML, so it quotes anything that would otherwise reparse
// wrongly — and the commonest trigger is a `: ` inside an accessible name
// (prices, error prefixes, "Category: Item" labels). When the *key* needs
// quoting it wraps the WHOLE descriptor in single quotes and doubles any inner
// `'`, turning
//     - button "Add to cart: Backpack" [ref=e12]:
// into
//     - 'button "Add to cart: Backpack" [ref=e12]':
// which LINE cannot match — so the element was silently dropped from the view.
// Nothing surfaced the loss: the element simply wasn't there, and the header's
// count agreed with itself. Unwrap the key before matching.
const QUOTED_KEY = /^(\s*)-\s+'((?:[^']|'')*)'\s*:?\s*$/
function unquoteKey(line) {
  const q = QUOTED_KEY.exec(line)
  return q ? `${q[1]}- ${q[2].replace(/''/g, "'")}` : line
}

// The same quoting applies to a node's *value* (double-quoted, backslash
// escapes) — a value keeping its literal quotes would corrupt an alert's folded
// message and any exact-match a driver does against it.
function unquoteValue(value) {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') return value
  return value.slice(1, -1).replace(/\\(["\\/bfnrt])/g, (_, c) => (
    { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[c] ?? c
  ))
}

function parseLine(line) {
  const m = LINE.exec(unquoteKey(line))
  if (!m) return null
  const [, indent, role, name = '', brackets = '', value = ''] = m
  const ref = (/\[ref=(e\d+)\]/.exec(brackets) || [])[1] || null
  const flags = FLAGS.filter(f => brackets.includes(`[${f}]`))
  return { indent: indent.length, role, name, ref, flags, value: unquoteValue(value.trim()) }
}

// Gather the text a node carries in its descendants (indented deeper), so a
// signal like `alert:` → `listitem: "Please provide…"` surfaces its message
// rather than an empty name.
function descendantText(nodes, i) {
  const parts = nodes[i].value ? [nodes[i].value] : []
  for (let j = i + 1; j < nodes.length && nodes[j].indent > nodes[i].indent; j++) {
    if (nodes[j].value) parts.push(nodes[j].value)
    else if (nodes[j].name && !INTERACTABLE.has(nodes[j].role)) parts.push(nodes[j].name)
  }
  return parts.join(' ').trim().slice(0, 100)
}

// Parse -> items. Relevance is decided by whether a node carries information —
// an accessible name or a value — not by a closed list of roles.
//
// The allowlist this replaces was a standing blind spot, because it excluded
// whole categories of meaningful content by construction. A validation message
// rendered as a heading, a data grid's cells and rows, a status line as a
// paragraph: all silently absent, however important. Measured on a real drive,
// a failed login showed the driver an unnamed dismiss button and NOT the error
// text sitting beside it — it could see that something went wrong but not what.
// No amount of re-observing recovered it; the role simply wasn't on the list.
//
// So the test is inverted, the same way the engine's perception core did it:
// keep what the platform says is meaningful, drop only what is structurally
// anonymous. A node with neither a name nor a value is a layout wrapper and
// carries nothing, which is the bulk of any snapshot — so this stays cheap
// while ceasing to be selectively blind.
//
// Signals still fold in their descendant text, and those descendants are then
// skipped so the message isn't reported twice. Long option runs still collapse.
export function extract(yaml) {
  const nodes = yaml.split('\n').map(parseLine).filter(Boolean)
  const raw = []
  const consumed = new Set()
  for (let i = 0; i < nodes.length; i++) {
    if (consumed.has(i)) continue
    const n = nodes[i]
    if (SIGNAL.has(n.role)) {
      const text = n.name || descendantText(nodes, i)
      // The folded descendants are this message; don't emit them again.
      for (let j = i + 1; j < nodes.length && nodes[j].indent > n.indent; j++) consumed.add(j)
      raw.push({ role: n.role, name: text, ref: n.ref, key: `${n.role}|${text}`, state: '', indent: n.indent })
      continue
    }
    if (isMeta(n.role) || ANONYMOUS.has(n.role)) continue
    const state = [n.value, ...n.flags].filter(Boolean).join(',')
    // Two different tests, because the two kinds of node earn their place
    // differently. An interactable is worth showing because you can ACT on it —
    // an icon button or a close `X` has no accessible name and is still the
    // control you need, so a ref is enough. Everything else is worth showing
    // only if it TELLS you something, so it needs a name or a value.
    if (INTERACTABLE.has(n.role) ? (!n.ref && !n.name) : (!n.name && !state)) continue
    raw.push({
      role: n.role, name: n.name, ref: n.ref,
      key: `${n.role}|${n.name || state}`,
      state, indent: n.indent,
    })
  }
  // Drop containers whose name is just their children's text run together.
  //
  // A grid row's accessible name is the concatenation of its cells', so keeping
  // both reports every value twice — measured at 92 rows against 90 gridcells
  // carrying identical names on one page, and roughly half the cost of showing
  // non-interactive content at all. The children are strictly more precise (one
  // value each, individually addressable), so the container is the one to go.
  //
  // Interactables and signals are never dropped this way: a `button "Save"`
  // wrapping the text "Save" is still the thing you click, and an alert is the
  // thing you read.
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const deduped = raw.filter((it, i) => {
    if (INTERACTABLE.has(it.role) || SIGNAL.has(it.role) || !it.name) return true
    const mine = norm(it.name)
    if (!mine) return true
    // Descendants are the deeper-indented run that follows this node.
    let covered = ''
    for (let j = i + 1; j < raw.length && raw[j].indent > it.indent; j++) {
      if (raw[j].name) covered += (covered ? ' ' : '') + norm(raw[j].name)
    }
    return !covered || !covered.includes(mine)
  })

  // Collapse consecutive option runs longer than OPTION_CAP.
  const items = []
  for (let i = 0; i < deduped.length;) {
    if (deduped[i].role === 'option') {
      let j = i
      while (j < deduped.length && deduped[j].role === 'option') j++
      const run = deduped.slice(i, j)
      if (run.length > OPTION_CAP) {
        items.push({
          role: 'option-list', ref: run[0].ref,
          name: `${run[0].name}…${run[run.length - 1].name}`,
          key: 'option-list', state: String(run.length),
        })
      } else items.push(...run)
      i = j
    } else { items.push(deduped[i]); i++ }
  }
  return items
}

function line(it, marker = '  ') {
  return `${marker}[${it.ref || '?'}] ${it.role} ${JSON.stringify(it.name)}` +
    (it.state ? ` = ${JSON.stringify(it.state)}` : '')
}
function renderFull(items) {
  return items.map(it => line(it)).join('\n')
}

// Full list with change markers vs prior (+ new, ~ changed, blank unchanged),
// plus removed lines. Every current element keeps its CURRENT ref — safe to act
// on — while the markers still surface what moved. This is the default: refs are
// reassigned per snapshot, so a pure diff (--diff) can leave stale refs for
// unchanged elements the driver still needs to click.
function renderAnnotated(prev, curr) {
  const pstate = new Map(prev.map(it => [it.key, it.state || '']))
  const pkeys = new Map()
  for (const it of prev) pkeys.set(it.key, (pkeys.get(it.key) || 0) + 1)
  const seen = new Map()
  const lines = curr.map(it => {
    const n = (seen.get(it.key) || 0) + 1; seen.set(it.key, n)
    let marker = '  '
    if (!pkeys.has(it.key) || n > pkeys.get(it.key)) marker = '+ '
    else if ((pstate.get(it.key) || '') !== (it.state || '')) marker = '~ '
    return line(it, marker)
  })
  const ckeys = new Map()
  for (const it of curr) ckeys.set(it.key, (ckeys.get(it.key) || 0) + 1)
  for (const it of prev) {
    if ((ckeys.get(it.key) || 0) < (pkeys.get(it.key) || 0)) {
      lines.push(`- ${it.role} ${JSON.stringify(it.name)}`)
      pkeys.set(it.key, pkeys.get(it.key) - 1) // emit each removal once
    }
  }
  const changed = lines.filter(l => l[0] === '+' || l[0] === '~' || l[0] === '-').length
  return { body: lines.join('\n'), changed }
}

// Diff two extracted lists. Collapses duplicate keys (presence-based): a signal
// like a button flipping "Add to cart" -> "Remove" surfaces as a clean add.
function diff(prev, curr) {
  const byKey = list => {
    const m = new Map()
    for (const it of list) {
      if (!m.has(it.key)) m.set(it.key, { ...it, count: 1 })
      else m.get(it.key).count++
    }
    return m
  }
  const p = byKey(prev)
  const c = byKey(curr)
  const lines = []
  for (const [key, it] of c) {
    if (!p.has(key)) lines.push(`+ [${it.ref || '?'}] ${it.role} ${JSON.stringify(it.name)}` + (it.state ? ` = ${JSON.stringify(it.state)}` : ''))
    else if ((p.get(key).state || '') !== (it.state || '')) lines.push(`~ ${it.role} ${JSON.stringify(it.name)} = ${JSON.stringify(it.state)}`)
  }
  for (const [key, it] of p) if (!c.has(key)) lines.push(`- ${it.role} ${JSON.stringify(it.name)}`)
  const churn = c.size ? lines.length / Math.max(c.size, p.size) : 1
  return { lines, churn }
}

// --- main ---
export function main(args) {
const opts = parseArgs(args)

if (opts.live) {
  // Take the snapshot ourselves (through forge-pw, so redaction applies), then
  // observe it — one call instead of the snapshot-then-observe two-step. The
  // echo carries the page URL, so navigation detection is self-contained.
  if (!opts.sessionSet) {
    console.error('forge-observe: --live requires the session: -s=<name>')
    process.exit(2)
  }
  const forgeRoot = findForgeRoot(process.cwd())
  const dir = forgeRoot ? join(forgeRoot, '.observe') : join(tmpdir(), 'forge-observe')
  try { mkdirSync(dir, { recursive: true }) } catch { /* readFileSync below reports it */ }
  opts.file = join(dir, `${opts.session}.yaml`)
  const forgeCli = join(dirname(fileURLToPath(import.meta.url)), '..', 'forge-cli.mjs')
  const pw = spawnSync(
    process.execPath,
    [forgeCli, 'pw', `-s=${opts.session}`, 'snapshot', `--filename=${opts.file}`],
    { encoding: 'utf8' }
  )
  if (pw.status !== 0) {
    process.stderr.write(pw.stderr || pw.stdout || '')
    console.error(`forge-observe: live snapshot failed (session ${opts.session})`)
    process.exit(3)
  }
  if (!opts.url) {
    const m = /^- Page URL:\s*(\S+)/m.exec(pw.stdout || '')
    if (m) opts.url = m[1]
  }
}

if (!opts.file) {
  console.error('forge-observe: usage: forge-cli.mjs observe --live -s=<name> [--diff|--full]  |  forge-cli.mjs observe <snapshot.yaml> [--session=<name>] [--url=<current-url>] [--state=<path>] [--diff] [--full]')
  process.exit(2)
}

let yaml
try {
  yaml = opts.file === '-' ? readFileSync(0, 'utf8') : readFileSync(opts.file, 'utf8')
} catch {
  console.error(`forge-observe: cannot read snapshot: ${opts.file}`)
  process.exit(1)
}
if (!yaml.trim()) {
  // In --live mode we took the snapshot ourselves and forge-pw succeeded (the
  // status check above), so an empty result is a genuinely blank page — e.g.
  // about:blank before the first navigation — not a failure. Report it as a
  // valid empty observation (exit 0) so a caller doesn't treat a fresh session
  // as an error. In file mode an empty file is a broken/missing handoff, which
  // stays an error.
  if (opts.live) {
    console.log(`# observe: session=${opts.session} | 0 interactable, 0 signal | empty (page has no accessible content yet) | ~0 tok`)
    process.exit(0)
  }
  console.error('forge-observe: snapshot is empty')
  process.exit(1)
}

const items = extract(yaml)
const statePath = opts.state ||
  join(opts.file === '-' ? process.cwd() : dirname(opts.file), `.forge-observe-${opts.session}.json`)

let priorState = null
if (!opts.full && existsSync(statePath)) {
  try { priorState = JSON.parse(readFileSync(statePath, 'utf8')) } catch { priorState = null }
}
const prior = priorState?.items || null
const priorUrl = priorState?.url || null
const navigated = !!(opts.url && priorUrl && opts.url !== priorUrl)

const rawTok = approxTok(yaml)
let out, mode
if (!prior || navigated) {
  // Fresh page: plain full baseline. Navigation is detected by URL change (when
  // --url is supplied), not by churn — an in-page popup isn't a navigation.
  out = renderFull(items)
  mode = navigated ? 'full (navigation)' : (opts.full ? 'full (forced)' : 'full (baseline)')
} else if (opts.diff) {
  // Aggressive: only what changed. Cheapest, but refs for unchanged elements
  // are not reshown (and shift per snapshot) — use to confirm effects, not to
  // pick up an unchanged element to act on.
  const d = diff(prior, items)
  if (!opts.url && d.churn >= REBASELINE_CHURN) {
    // No URL to judge navigation by — fall back to the churn heuristic.
    out = renderFull(items)
    mode = `full (re-baseline: churn ${(d.churn * 100).toFixed(0)}%)`
  } else {
    out = d.lines.length ? d.lines.join('\n') : '(no interactable changes)'
    mode = `diff (${d.lines.length} change${d.lines.length === 1 ? '' : 's'})`
  }
} else {
  // Default: full filtered list with change markers — current refs everywhere.
  const a = renderAnnotated(prior, items)
  out = a.body
  mode = `full+marks (${a.changed} changed)`
}
const tok = approxTok(out)

try {
  writeFileSync(statePath, JSON.stringify({ session: opts.session, url: opts.url ?? priorUrl ?? null, items }))
} catch { /* best-effort; a missing state file just forces a baseline next time */ }

const sigs = items.filter(it => SIGNAL.has(it.role)).length
console.log(`# observe: session=${opts.session} | ${items.length} interactable, ${sigs} signal | ${mode} | ~${tok} tok (raw snapshot ~${rawTok} tok)`)
console.log(out)
}
