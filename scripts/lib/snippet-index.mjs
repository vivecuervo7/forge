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
//   5. Idempotent — running twice produces the same file.
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
//   0   INDEX.md written (or no-op if no snippets directory exists)
//   1   no forge root found
//   2   usage / parse error

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
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

  return renderMarkdown(records, primitives)
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

  // Group by flow
  const byFlow = new Map()
  for (const r of records) {
    const flow = (r.meta && r.meta.flow) || ''
    if (!byFlow.has(flow)) byFlow.set(flow, [])
    byFlow.get(flow).push(r)
  }

  // Sort: named flows first (alphabetical), misc last.
  const flows = [...byFlow.keys()].sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })

  // Pad name(args) within each section so the `→` columns line up loosely.
  // No global alignment — keeps small sections tight.
  for (const flow of flows) {
    const heading = flow === '' ? 'misc' : `flow: ${flow}`
    lines.push(heading)

    const section = byFlow.get(flow)
    const heads = section.map(r => `${r.name}${formatArgs(r.meta.args)}`)
    const widest = heads.reduce((m, h) => Math.max(m, h.length), 0)
    // Cap padding so a single long arg list doesn't blow out the section.
    const padTo = Math.min(widest, 56)

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

      lines.push(`  - ${padded}${tail}`)
    }
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

const md = buildIndex(snippetsDir, { verbose })
const outPath = join(snippetsDir, 'INDEX.md')
writeFileSync(outPath, md + '\n', 'utf8')
console.log(`forge-snippet-index: wrote ${outPath}`)
}
