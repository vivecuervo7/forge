#!/usr/bin/env node
// forge-observe.mjs — deterministic perception primitive.
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
//   forge-observe.mjs <snapshot.yaml> [--session=<name>] [--state=<path>] [--full]
//   forge-observe.mjs -            (read snapshot YAML from stdin)
//
//   --session=<name>  namespaces the diff state (default: "default")
//   --state=<path>    where prior state is kept (default: alongside the snapshot,
//                     `.forge-observe-<session>.json`)
//   --full            always print the full filtered view (skip diffing)
//
// Behaviour:
//   - No prior state for the session, or churn vs prior is high (a navigation) →
//     prints the full filtered view and re-baselines.
//   - Otherwise prints the diff (+ added / - removed / ~ value-changed) keyed on
//     role+name (NOT ref — refs are reassigned every snapshot; and NOT id —
//     ids are volatile, e.g. GUID-suffixed error ids).
//
// Exit codes:
//   0  observed (full or diff printed)
//   1  snapshot file unreadable / empty
//   2  usage error

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const INTERACTABLE = new Set([
  'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider',
  'searchbox', 'spinbutton', 'listbox',
])
const SIGNAL = new Set(['alert', 'alertdialog', 'status']) // errors / live regions
const FLAGS = ['checked', 'selected', 'disabled', 'expanded', 'pressed']

// churn ratio above which a diff is treated as a navigation (re-baseline)
const REBASELINE_CHURN = 0.6
const approxTok = s => Math.ceil((s?.length || 0) / 4)

function parseArgs(argv) {
  const opts = { session: 'default', state: null, full: false, file: null }
  for (const a of argv) {
    if (a === '--full') opts.full = true
    else if (a.startsWith('--session=')) opts.session = a.slice('--session='.length)
    else if (a.startsWith('--state=')) opts.state = a.slice('--state='.length)
    else if (!a.startsWith('--')) opts.file = a
  }
  return opts
}

// One YAML snapshot line -> a node, or null if it isn't an element line.
const LINE = /^\s*-\s+([^\s"[:]+)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s*\[[^\]]*\])*)\s*(?::\s*(.*?))?\s*$/
function parseLine(line) {
  const m = LINE.exec(line)
  if (!m) return null
  const [, role, name = '', brackets = '', value = ''] = m
  const ref = (/\[ref=(e\d+)\]/.exec(brackets) || [])[1] || null
  const flags = FLAGS.filter(f => brackets.includes(`[${f}]`))
  return { role, name, ref, flags, value: value.trim() }
}

// Keep only interactables + signals. `key` collapses duplicates for diffing;
// `state` folds in the value + flags that a diff should notice.
function extract(yaml) {
  const items = []
  for (const raw of yaml.split('\n')) {
    const node = parseLine(raw)
    if (!node) continue
    if (!INTERACTABLE.has(node.role) && !SIGNAL.has(node.role)) continue
    items.push({
      role: node.role,
      name: node.name,
      ref: node.ref,
      key: `${node.role}|${node.name}`,
      state: [node.value, ...node.flags].filter(Boolean).join(','),
    })
  }
  return items
}

function renderFull(items) {
  return items.map(it =>
    `[${it.ref || '?'}] ${it.role} ${JSON.stringify(it.name)}` +
    (it.state ? ` = ${JSON.stringify(it.state)}` : '')).join('\n')
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
const opts = parseArgs(process.argv.slice(2))
if (!opts.file) {
  console.error('forge-observe: usage: forge-observe.mjs <snapshot.yaml> [--session=<name>] [--state=<path>] [--full]')
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
  console.error('forge-observe: snapshot is empty')
  process.exit(1)
}

const items = extract(yaml)
const statePath = opts.state ||
  join(opts.file === '-' ? process.cwd() : dirname(opts.file), `.forge-observe-${opts.session}.json`)

let prior = null
if (!opts.full && existsSync(statePath)) {
  try { prior = JSON.parse(readFileSync(statePath, 'utf8')).items } catch { prior = null }
}

const rawTok = approxTok(yaml)
let out, mode, tok
if (!prior) {
  const body = renderFull(items)
  out = body
  mode = opts.full ? 'full (forced)' : 'full (baseline)'
  tok = approxTok(body)
} else {
  const d = diff(prior, items)
  if (d.churn >= REBASELINE_CHURN) {
    const body = renderFull(items)
    out = body
    mode = `full (re-baseline: churn ${(d.churn * 100).toFixed(0)}%)`
    tok = approxTok(body)
  } else {
    const body = d.lines.length ? d.lines.join('\n') : '(no interactable changes)'
    out = body
    mode = `diff (${d.lines.length} change${d.lines.length === 1 ? '' : 's'})`
    tok = approxTok(body)
  }
}

try {
  writeFileSync(statePath, JSON.stringify({ session: opts.session, items }))
} catch { /* best-effort; a missing state file just forces a baseline next time */ }

const sigs = items.filter(it => SIGNAL.has(it.role)).length
console.log(`# observe: session=${opts.session} | ${items.length} interactable, ${sigs} signal | ${mode} | ~${tok} tok (raw snapshot ~${rawTok} tok)`)
console.log(out)
