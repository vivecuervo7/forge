#!/usr/bin/env node
// forge-snippet-index.mjs — generate forge/snippets/INDEX.md from the meta
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
//   4. Writes a Markdown table to <forge>/snippets/INDEX.md. Snippets are
//      grouped by `meta.flow` if set; ungrouped land under "Misc."
//   5. Idempotent — running twice produces the same file.
//
// Schema (see agents/snippet-author.md for the canonical doc):
//   description: string           (required, one-liner)
//   args:        object           (required, may be empty)
//   tags:        string[]         (optional, free-form)
//   flow:        string           (optional, groups snippets by multi-step
//                                  flow they belong to, e.g. 'is-group-reg')
//   phase:       string           (optional, phase within the flow,
//                                  e.g. 'summary→payment')
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
import { dirname, basename, join, resolve } from 'node:path'

function findForgeRoot(start) {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, 'forge', 'hints'))) return join(dir, 'forge')
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function extractMetaSource(src) {
  // Match `export const meta = { ... }` at the start of file (allow leading
  // comments + whitespace). Balanced-brace scan from the first `{` to handle
  // nested object/array literals inside meta.
  const declMatch = src.match(/export\s+const\s+meta\s*=\s*/m)
  if (!declMatch) return null

  const startIdx = declMatch.index + declMatch[0].length
  if (src[startIdx] !== '{') return null

  let depth = 0
  let inString = null  // null | "'" | '"' | '`'
  let inLineComment = false
  let inBlockComment = false
  let escape = false

  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return src.slice(startIdx, i + 1)
      }
    }
  }
  return null
}

function evalMeta(metaSrc, snippetName) {
  // Evaluate the meta literal in a sandbox. Wrap in parens so the `{...}`
  // parses as an expression, not a block.
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${metaSrc});`)
    return fn()
  } catch (e) {
    console.error(`forge-snippet-index: failed to parse meta in ${snippetName}: ${e.message}`)
    return null
  }
}

function formatArgs(args) {
  if (!args || typeof args !== 'object') return ''
  const keys = Object.keys(args)
  if (keys.length === 0) return '(none)'
  return keys.map(k => {
    const v = args[k]
    if (typeof v === 'string') return `\`${k}\`: ${v}`
    if (v && typeof v === 'object') {
      const parts = []
      if (v.type) parts.push(v.type)
      if (v.optional) parts.push('optional')
      if (v.description) parts.push(v.description)
      return `\`${k}\`${parts.length ? ` (${parts.join(', ')})` : ''}`
    }
    return `\`${k}\``
  }).join('; ')
}

function escapeCell(s) {
  if (s === undefined || s === null) return ''
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function buildIndex(snippetsDir, opts = {}) {
  const entries = readdirSync(snippetsDir)
    .filter(f => f.endsWith('.ts'))
    .sort()

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

    const meta = evalMeta(metaSrc, file)
    if (meta === null) {
      records.push({ name, meta: {}, error: 'meta parse failed' })
      continue
    }
    records.push({ name, meta })
  }

  emitHygieneWarnings(records, opts)

  return renderMarkdown(records)
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

    if (/^ae-\d+/i.test(r.name)) {
      record('jiraFilename', filename, 'filename looks like a Jira key — rename to <verb>-<noun>[-<modifier>]')
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
    console.error('forge-snippet-index: re-run with --verbose for per-snippet detail; see agents/snippet-author.md for hygiene guidance')
  } else if (total > 0) {
    console.error('forge-snippet-index: review hygiene warnings — see agents/snippet-author.md')
  }
}

function renderMarkdown(records) {
  const lines = []
  lines.push('<!--')
  lines.push('  AUTO-GENERATED — do not edit by hand.')
  lines.push('  Refresh with:')
  lines.push('    node <plugin-root>/scripts/forge-snippet-index.mjs')
  lines.push('  (or pass an explicit forge root as the first arg)')
  lines.push('-->')
  lines.push('')
  lines.push('# Snippet library')
  lines.push('')
  lines.push(`${records.length} snippet(s) in this library.`)
  lines.push('')

  // Group by flow
  const byFlow = new Map()
  for (const r of records) {
    const flow = (r.meta && r.meta.flow) || ''
    if (!byFlow.has(flow)) byFlow.set(flow, [])
    byFlow.get(flow).push(r)
  }

  // Sort: named flows first (alphabetical), Misc last
  const flows = [...byFlow.keys()].sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })

  for (const flow of flows) {
    const heading = flow === '' ? 'Misc.' : `Flow: \`${flow}\``
    lines.push(`## ${heading}`)
    lines.push('')
    lines.push('| Name | Description | Args | Phase |')
    lines.push('|------|-------------|------|-------|')
    for (const r of byFlow.get(flow)) {
      const description = r.error
        ? `_(${r.error})_`
        : (r.meta.description || '')
      const args = formatArgs(r.meta.args)
      const phase = r.meta.phase || ''
      lines.push(
        `| \`${r.name}\` | ${escapeCell(description)} | ${escapeCell(args)} | ${escapeCell(phase)} |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

// --- main ---

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const positional = args.filter(a => !a.startsWith('--'))
const explicitRoot = positional[0]
let forgeRoot
if (explicitRoot) {
  const resolved = resolve(explicitRoot)
  // Accept either the forge dir itself or its parent.
  if (existsSync(join(resolved, 'hints'))) {
    forgeRoot = resolved
  } else if (existsSync(join(resolved, 'forge', 'hints'))) {
    forgeRoot = join(resolved, 'forge')
  } else {
    console.error(`forge-snippet-index: not a forge directory or project root: ${resolved}`)
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
