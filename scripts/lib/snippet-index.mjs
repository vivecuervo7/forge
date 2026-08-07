// snippet-index — generate forge/snippets/INDEX.md from the meta
// blocks of every snippet in a project's forge/snippets/ directory.
//
// Why this exists: the driver agent (and the lead's session-start scan)
// would otherwise need to Read each .ts file individually to discover what
// snippets exist and what they do. An auto-generated INDEX.md collapses
// that into a single Read.
//
// What this does:
//
//   1. Locates the project's forge root (same logic as forge-find-root.mjs).
//   2. Globs <forge>/snippets/*.ts.
//   3. Extracts the `meta` block from each snippet by regex + evaluation in
//      a sandboxed JS context. We don't esbuild — meta is always the first
//      export and is a plain object literal; a regex + new Function() round
//      handles 100% of the real-world snippet shapes cheaply.
//   4. Writes a compact, flow-grouped listing to <forge>/snippets/INDEX.md.
//      Snippets are grouped by `meta.flow`; ungrouped snippets land in a
//      `misc` group at the bottom. Each line is
//        `  - <name>(<args>)  → <description> [phase: ...] [enters: ...] [requires: ...]`
//      Optional metadata bracket-suffixes are only emitted when present.
//   5. Also writes <forge>/snippets/index/ — FLOWS.md (every flow, its size,
//      where its detail lives, and the bare snippet names it holds) plus one
//      <flow>.md slice per flow carrying the full lines. The driver reads FLOWS.md
//      and then only the flows its task touches; reading INDEX.md whole costs it
//      the entire library on every drive, which for a mature one is ~20k tokens of
//      which nearly all describes work the task will never reach. INDEX.md itself
//      is unchanged — the curator needs the whole picture to spot duplicates, and
//      cleanup wants to survey everything.
//   6. Idempotent — running twice produces the same files.
//
// Schema (see agents/curator.md for the canonical doc):
//   description: string           (required, one-liner)
//   args:        object           (required, may be empty)
//   tags:        string[]         (optional, free-form)
//   flow:        string           (optional, groups snippets by multi-step
//                                  flow they belong to, e.g. 'checkout')
//   phase:       string           (optional, phase within the flow,
//                                  e.g. 'cart→payment')
//   enters:      string           (optional, state the snippet leaves the
//                                  page in)
//   requires:    string           (optional, state the page must be in
//                                  before invoking)
//   composes:    string[]         (optional, names of snippets this one
//                                  shells out to)
//   supersedes:  string[]         (optional, names of older snippets this
//                                  replaces — useful when iterating)
//
// Missing fields are handled gracefully (empty cells). Snippets without
// `flow` go in Misc.
//
// Usage:
//   forge-snippet-index.mjs                  # from PWD's forge root
//   forge-snippet-index.mjs <forge-root>     # explicit forge dir
//   forge-snippet-index.mjs --verbose        # one stderr line per hygiene issue
//                                            # (default is a per-category summary)
//
// Exit codes:
//   0   INDEX.md and index/ written (or no-op if no snippets directory exists)
//   1   no forge root found
//   2   usage / parse error

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  findForgeRoot,
  resolveForgeRootArg,
  extractMetaSource,
  evalMeta,
  ticketKeyPrefix,
} from './common.mjs'

// Compact arg shorthand: just the names, comma-separated. Returns `()` for
// zero-arg snippets so the entry shape stays uniform. The full arg metadata
// (types, optionality, descriptions) lives in the snippet's own meta block
// — the index is for orientation, not signature lookup.
function formatArgs(args) {
  if (!args || typeof args !== 'object') return '()'
  const keys = Object.keys(args)
  if (keys.length === 0) return '()'
  return `(${keys.join(', ')})`
}

// Take the first sentence (up to the first period) of a description and cap
// it at ~120 chars. Newlines collapse to spaces. Returns '' for empty input.
function compactDescription(desc) {
  if (desc === undefined || desc === null) return ''
  let s = String(desc).replace(/\s+/g, ' ').trim()
  if (s === '') return ''
  const dotIdx = s.indexOf('.')
  if (dotIdx !== -1) s = s.slice(0, dotIdx)
  if (s.length > 120) s = s.slice(0, 117).trimEnd() + '…'
  return s
}

// Bracket-suffix only when the field is set and reasonably short.
function bracketSuffix(label, value, maxLen = 80) {
  if (value === undefined || value === null) return ''
  const s = String(value).replace(/\s+/g, ' ').trim()
  if (s === '' || s.length > maxLen) return ''
  return ` [${label}: ${s}]`
}

// A primitive's one-liner is its header comment, wrapped lines joined up to
// the first sentence end: `// _<name>.ts — <description...>`
function primitiveDescription(src) {
  const head = src.split('\n', 8)
  for (let i = 0; i < head.length; i++) {
    const m = head[i].match(/^\/\/ _[\w-]+\.ts — (.+)$/)
    if (!m) continue
    let desc = m[1].trim()
    while (!/\.(\s|$)/.test(desc) && i + 1 < head.length) {
      const cont = head[++i].match(/^\/\/ (\S.*)$/)
      if (!cont) break
      desc += ` ${cont[1].trim()}`
    }
    return desc.split(/(?<=\.)\s/)[0].replace(/\.$/, '')
  }
  return ''
}

function buildIndex(snippetsDir, opts = {}) {
  const allFiles = readdirSync(snippetsDir).filter(f => f.endsWith('.ts')).sort()
  // Underscore-prefixed files are shared primitives (imported by snippets,
  // no meta block, not invocable) — indexed on their own line, not as snippets.
  const entries = allFiles.filter(f => !f.startsWith('_'))
  const primitives = allFiles
    .filter(f => f.startsWith('_'))
    .map(f => {
      let desc = ''
      try {
        desc = primitiveDescription(readFileSync(join(snippetsDir, f), 'utf8'))
      } catch { /* unreadable — list by name alone */ }
      return { name: basename(f, '.ts'), desc }
    })

  const records = []
  for (const file of entries) {
    const fullPath = join(snippetsDir, file)
    let src
    try {
      src = readFileSync(fullPath, 'utf8')
    } catch (e) {
      console.error(`forge-snippet-index: failed to read ${file}: ${e.message}`)
      continue
    }

    const name = basename(file, '.ts')
    const metaSrc = extractMetaSource(src)
    if (!metaSrc) {
      records.push({ name, meta: {}, error: 'no meta block found' })
      continue
    }

    const { meta, error } = evalMeta(metaSrc)
    if (meta === null) {
      console.error(`forge-snippet-index: failed to parse meta in ${file}: ${error}`)
      records.push({ name, meta: {}, error: 'meta parse failed' })
      continue
    }
    records.push({ name, meta })
  }

  emitHygieneWarnings(records, opts)

  return { markdown: renderMarkdown(records, primitives), records, primitives }
}

// Heuristic: does the description suggest a multi-step flow?
// Conservative — false-positive cost is one stderr line, not a failure.
const FLOW_WORDS = ['step', 'flow', 'phase', 'register', 'submit', 'navigate']

// Snippet names that look like canonical leaf primitives — skip the
// "missing flow/phase" warning for these even if the description happens
// to contain a flow-word.
const LEAF_PRIMITIVE_RE = /^(click|read|count|extract|goto|open|scroll|switch|back|advance)-/

function isLeafPrimitive(name) {
  return LEAF_PRIMITIVE_RE.test(name)
}

function descriptionSuggestsFlow(description) {
  if (!description || typeof description !== 'string') return false
  const lower = description.toLowerCase()
  return FLOW_WORDS.some(w => lower.includes(w))
}

// Category labels — keep short, summary-friendly.
const HYGIENE_CATEGORIES = {
  missingDescription: 'snippets with missing or empty description',
  missingTags: 'snippets with missing meta.tags',
  tagsNotArray: 'snippets with meta.tags that is not an array',
  emptyTags: 'snippets with empty tags',
  noiseTags: "snippets with 'auto-authored' in tags",
  jiraFilename: 'snippets with Jira-key filename',
  multiStepNoFlow: 'snippets with multi-step descriptions but no flow/phase',
}

function emitHygieneWarnings(records, opts = {}) {
  const { verbose = false } = opts
  const buckets = Object.fromEntries(
    Object.keys(HYGIENE_CATEGORIES).map(k => [k, []])
  )
  const record = (category, filename, issue) => {
    buckets[category].push({ filename, issue })
  }

  for (const r of records) {
    if (r.error) continue  // parse-level issues already reported
    const filename = `${r.name}.ts`
    const meta = r.meta || {}

    if (!meta.description || (typeof meta.description === 'string' && meta.description.trim() === '')) {
      record('missingDescription', filename, 'meta.description is missing or empty')
    }

    if (!('tags' in meta)) {
      record('missingTags', filename, 'meta.tags is missing — supply real tags or compute from flow/phase')
    } else if (!Array.isArray(meta.tags)) {
      record('tagsNotArray', filename, 'meta.tags is not an array')
    } else if (meta.tags.length === 0) {
      record('emptyTags', filename, 'meta.tags is empty — supply real tags or compute from flow/phase')
    } else if (meta.tags.includes('auto-authored')) {
      record('noiseTags', filename, "meta.tags contains 'auto-authored' — replace with discovery-aiding tags")
    }

    if (ticketKeyPrefix(r.name)) {
      record('jiraFilename', filename, 'filename looks like a ticket key — rename to <verb>-<noun>[-<modifier>]')
    }

    const hasFlow = meta.flow && String(meta.flow).trim() !== ''
    const hasPhase = meta.phase && String(meta.phase).trim() !== ''
    if (!hasFlow && !hasPhase
        && descriptionSuggestsFlow(meta.description)
        && !isLeafPrimitive(r.name)) {
      record('multiStepNoFlow', filename, 'description suggests a multi-step flow but neither meta.flow nor meta.phase is set')
    }
  }

  // In verbose mode, emit every per-snippet warning before the summary.
  if (verbose) {
    for (const category of Object.keys(buckets)) {
      for (const { filename, issue } of buckets[category]) {
        console.error(`forge-snippet-index: ${filename}: ${issue}`)
      }
    }
  }

  // Summary: one line per non-empty category, then the review pointer.
  let total = 0
  for (const category of Object.keys(buckets)) {
    const count = buckets[category].length
    if (count === 0) continue
    total += count
    const label = HYGIENE_CATEGORIES[category]
    console.error(`forge-snippet-index: ${count} ${label}`)
  }
  if (total > 0 && !verbose) {
    console.error('forge-snippet-index: re-run with --verbose for per-snippet detail; see agents/curator.md for hygiene guidance')
  } else if (total > 0) {
    console.error('forge-snippet-index: review hygiene warnings — see agents/curator.md')
  }
}

// Group records by meta.flow; ungrouped land under ''.
function groupByFlow(records) {
  const byFlow = new Map()
  for (const r of records) {
    const flow = (r.meta && r.meta.flow) || ''
    if (!byFlow.has(flow)) byFlow.set(flow, [])
    byFlow.get(flow).push(r)
  }
  return byFlow
}

// Named flows first (alphabetical), misc last.
function sortedFlows(byFlow) {
  return [...byFlow.keys()].sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })
}

// The `  - name(args)  → description [tags]` lines for one flow. Shared by the
// full index and the per-flow slices so the two can never drift.
function sectionLines(section) {
  // Pad name(args) within each section so the `→` columns line up loosely.
  // No global alignment — keeps small sections tight.
  const heads = section.map(r => `${r.name}${formatArgs(r.meta.args)}`)
  const widest = heads.reduce((m, h) => Math.max(m, h.length), 0)
  // Cap padding so a single long arg list doesn't blow out the section.
  const padTo = Math.min(widest, 56)

  const out = []
  for (let i = 0; i < section.length; i++) {
    const r = section[i]
    const head = heads[i]
    const padded = head.length >= padTo ? head : head + ' '.repeat(padTo - head.length)

    const description = r.error
      ? `(${r.error})`
      : compactDescription(r.meta.description)

    const phase = bracketSuffix('phase', r.meta && r.meta.phase)
    const enters = bracketSuffix('enters', r.meta && r.meta.enters)
    const requires = bracketSuffix('requires', r.meta && r.meta.requires)

    const tail = description
      ? `  → ${description}${phase}${enters}${requires}`
      : `${phase}${enters}${requires}`

    out.push(`  - ${padded}${tail}`)
  }
  return out
}

// A flow name as a filename stem. Flow names are free-form, so they can carry
// spaces, slashes and arrows (e.g. 'cart→payment').
export function flowSlug(flow) {
  const s = String(flow || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'misc'
}

// The orientation file: every flow, its size, where its detail lives, and the
// bare snippet names it holds.
//
// Reading the full index costs the driver the whole library on every drive — for
// a mature one that is ~20k tokens, of which all but a flow or two describes work
// the task will never touch. This is the small read that makes a targeted second
// read possible: names are enough to choose a flow, often enough to choose the
// snippet outright, and the descriptions and preconditions stay in the slice.
function renderFlowsToc(byFlow, primitives = []) {
  const flows = sortedFlows(byFlow)
  const total = [...byFlow.values()].reduce((a, s) => a + s.length, 0)
  const lines = []
  lines.push('# Snippet FLOWS (auto-generated) — read this first, then only the flows your task needs.')
  lines.push('# Refresh: node <plugin-root>/scripts/forge-cli.mjs snippet-index')
  lines.push('#')
  lines.push(`# ${total} snippet(s) across ${flows.length} flow(s). Per-flow detail: snippets/index/<flow>.md`)
  lines.push('# snippets/INDEX.md holds every entry in one file — for browsing and cleanup, not for driving.')
  if (primitives.length) {
    lines.push(`# ${primitives.length} primitive(s) (import into snippets/specs; not invocable) are listed in INDEX.md.`)
  }
  lines.push('')
  for (const flow of flows) {
    const section = byFlow.get(flow)
    lines.push(`flow: ${flow === '' ? 'misc' : flow}  (${section.length})  → snippets/index/${flowSlug(flow)}.md`)
    // Bare names, wrapped — enough to pick a flow without pulling its detail.
    let line = '  '
    for (const r of section) {
      const piece = (line.trim() === '' ? '' : ', ') + r.name
      if (line.length + piece.length > 96) {
        lines.push(line)
        line = '  ' + r.name
      } else {
        line += piece
      }
    }
    if (line.trim() !== '') lines.push(line)
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

function renderFlowFile(flow, section) {
  const lines = []
  lines.push(`# Snippet flow: ${flow === '' ? 'misc' : flow} (auto-generated)`)
  lines.push('# Refresh: node <plugin-root>/scripts/forge-cli.mjs snippet-index')
  lines.push(`# ${section.length} snippet(s). Other flows: snippets/index/FLOWS.md`)
  lines.push('')
  lines.push(flow === '' ? 'misc' : `flow: ${flow}`)
  lines.push(...sectionLines(section))
  return lines.join('\n').replace(/\n+$/, '\n')
}

function renderMarkdown(records, primitives = []) {
  const lines = []
  lines.push('# Snippet INDEX (auto-generated)')
  lines.push('# Refresh: node <plugin-root>/scripts/forge-cli.mjs snippet-index')
  lines.push('')
  lines.push(`# ${records.length} snippet(s) — grouped by flow:; ungrouped land in misc`)
  for (const p of primitives) {
    lines.push(`# primitive (import into snippets/specs; not invocable): ${p.name}${p.desc ? ` — ${p.desc}` : ''}`)
  }
  lines.push('')

  const byFlow = groupByFlow(records)
  for (const flow of sortedFlows(byFlow)) {
    lines.push(flow === '' ? 'misc' : `flow: ${flow}`)
    lines.push(...sectionLines(byFlow.get(flow)))
    lines.push('')
  }

  return lines.join('\n').replace(/\n+$/, '\n')
}

// --- main ---

export function main(args) {
const verbose = args.includes('--verbose')
const positional = args.filter(a => !a.startsWith('--'))
const explicitRoot = positional[0]
let forgeRoot
if (explicitRoot) {
  // Accept either the forge dir itself or its parent.
  forgeRoot = resolveForgeRootArg(explicitRoot)
  if (!forgeRoot) {
    console.error(`forge-snippet-index: not a forge directory or project root: ${explicitRoot}`)
    process.exit(1)
  }
} else {
  forgeRoot = findForgeRoot(process.cwd())
  if (!forgeRoot) {
    console.error('forge-snippet-index: no forge/ directory found in cwd or any parent')
    process.exit(1)
  }
}

const snippetsDir = join(forgeRoot, 'snippets')
if (!existsSync(snippetsDir) || !statSync(snippetsDir).isDirectory()) {
  console.error(`forge-snippet-index: no snippets/ directory at ${snippetsDir} — nothing to index`)
  process.exit(0)
}

const { markdown, records, primitives } = buildIndex(snippetsDir, { verbose })
const outPath = join(snippetsDir, 'INDEX.md')
writeFileSync(outPath, markdown + '\n', 'utf8')

// Per-flow slices plus a FLOWS.md orientation file. Rewritten wholesale each run
// so a renamed or emptied flow cannot leave a stale slice behind for the driver
// to read.
const indexDir = join(snippetsDir, 'index')
try { rmSync(indexDir, { recursive: true, force: true }) } catch { /* first run */ }
mkdirSync(indexDir, { recursive: true })

const byFlow = groupByFlow(records)
writeFileSync(join(indexDir, 'FLOWS.md'), renderFlowsToc(byFlow, primitives) + '\n', 'utf8')

const slugs = new Map()
for (const flow of sortedFlows(byFlow)) {
  // Two flow names can reduce to the same stem ('cart payment' and
  // 'cart→payment'); suffix rather than silently overwriting one with the other.
  let slug = flowSlug(flow)
  if (slugs.has(slug)) {
    let n = 2
    while (slugs.has(`${slug}-${n}`)) n++
    slug = `${slug}-${n}`
  }
  slugs.set(slug, flow)
  writeFileSync(join(indexDir, `${slug}.md`), renderFlowFile(flow, byFlow.get(flow)) + '\n', 'utf8')
}
console.log(`forge-snippet-index: wrote ${outPath} and ${slugs.size} flow slice(s) in ${indexDir}`)
}
