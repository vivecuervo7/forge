// cleanup-scan — emit a structured JSON report of cleanup
// candidates in a project's forge/ directory. Read-only — never mutates.
//
// The /forge clean route's lead reads this output and surfaces findings
// to the user via AskUserQuestion. The script does the boring deterministic
// scan-work; judgement lives in the lead.
//
// Scopes:
//   --scope snippets  → only snippet candidates (default: both)
//   --scope hints     → only hint-section candidates
//   --scope both      → both (default)
//
// Usage:
//   forge-cleanup-scan.mjs                            # PWD's forge root, both
//   forge-cleanup-scan.mjs --scope snippets           # snippets only
//   forge-cleanup-scan.mjs --forge-root <path> --scope hints
//
// Exit codes:
//   0   JSON report written to stdout
//   1   no forge root found / read error
//   2   usage error

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import {
  findForgeRoot,
  resolveForgeRootArg,
  extractMetaSource,
  evalMeta,
  ticketKeyPrefix,
} from './common.mjs'

// --- parsed CLI state (assigned by main; the scan flow lives in run()) ---

let scope = 'both'
let explicitRoot = null
let forgeRoot

export async function main(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--scope') {
      scope = args[++i]
      if (!['snippets', 'hints', 'both'].includes(scope)) {
        console.error(`forge-cleanup-scan: --scope must be one of snippets|hints|both`)
        process.exit(2)
      }
    } else if (a === '--forge-root') {
      explicitRoot = args[++i]
    } else if (a === '--help' || a === '-h') {
      console.error('usage: forge-cli.mjs cleanup-scan [--scope snippets|hints|both] [--forge-root <path>]')
      process.exit(2)
    } else {
      console.error(`forge-cleanup-scan: unknown arg: ${a}`)
      process.exit(2)
    }
  }

  // --- forge root resolution (shared walk — see common.mjs) ---
  if (explicitRoot) {
    forgeRoot = resolveForgeRootArg(explicitRoot)
    if (!forgeRoot) {
      console.error(`forge-cleanup-scan: not a forge directory or project root: ${explicitRoot}`)
      process.exit(1)
    }
  } else {
    forgeRoot = findForgeRoot(process.cwd())
    if (!forgeRoot) {
      console.error('forge-cleanup-scan: no forge/ directory found')
      process.exit(1)
    }
  }

  await run()
}

// --- tokenisation / similarity helpers ---

const STOPWORDS = new Set([
  'a','an','and','the','of','to','in','on','for','with','from','by',
  'is','are','was','be','this','that','these','those','at','as','it',
  'or','if','then','via','into','out','up','down','step','page','via',
])

function tokenize(s) {
  if (!s) return new Set()
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t))
  )
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// --- body code-block overlap ---

function extractRunBody(src) {
  // Best-effort: take everything from `export async function run` onwards.
  const m = src.match(/export\s+async\s+function\s+run\b/)
  if (!m) return ''
  return src.slice(m.index)
}

function normalisedLines(body) {
  // Return non-empty, non-comment, non-brace lines only. Compacting in-place
  // (rather than preserving positions with null) makes "contiguous shared
  // run" mean "shared sequence of executable statements" rather than
  // requiring identical comment layout between the two snippets — which is
  // the failure mode we want to flag.
  return body.split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l !== '' && !l.startsWith('//') && !l.startsWith('*') && l !== '{' && l !== '}')
}

function longestSharedRun(linesA, linesB) {
  // Longest contiguous run of identical lines.
  let best = 0
  let bestStart = -1
  for (let i = 0; i < linesA.length; i++) {
    for (let j = 0; j < linesB.length; j++) {
      let k = 0
      while (
        i + k < linesA.length &&
        j + k < linesB.length &&
        linesA[i + k] === linesB[j + k]
      ) k++
      if (k > best) { best = k; bestStart = i }
    }
  }
  return { len: best, start: bestStart }
}

// --- snippets scan ---

function scanSnippets(snippetsDir) {
  const out = {
    files: [],
    flagged: [],
    overlapClusters: { byFlowPhase: [], byDescription: [], byBody: [] },
  }
  if (!existsSync(snippetsDir) || !statSync(snippetsDir).isDirectory()) {
    return { ...out, error: `no snippets/ directory at ${snippetsDir}` }
  }
  const entries = readdirSync(snippetsDir)
    // Underscore-prefixed files are shared primitives (no meta block, imported
    // not invoked) — scanning them as snippets would flag them as broken.
    .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
    .sort()

  const records = []
  for (const file of entries) {
    const fullPath = join(snippetsDir, file)
    let src
    try { src = readFileSync(fullPath, 'utf8') }
    catch (e) {
      out.files.push({ file, error: `read failed: ${e.message}` })
      continue
    }
    const name = basename(file, '.ts')
    const metaSrc = extractMetaSource(src)
    let meta = null
    let metaError = null
    if (!metaSrc) metaError = 'no meta block found'
    else {
      meta = evalMeta(metaSrc).meta
      if (!meta) metaError = 'meta parse failed'
    }
    const body = extractRunBody(src)
    records.push({
      file, name, src, meta, metaError,
      bodyLines: normalisedLines(body),
      descTokens: tokenize(meta && meta.description),
    })
    out.files.push({ file, name })
  }

  // Per-file flags
  for (const r of records) {
    const flags = []
    if (r.metaError) flags.push({ kind: 'meta-missing-or-broken', detail: r.metaError })
    else {
      const m = r.meta
      if (!m.description || String(m.description).trim() === '')
        flags.push({ kind: 'description-missing', detail: 'meta.description empty or missing' })
      if (!Array.isArray(m.tags) || m.tags.length === 0)
        flags.push({ kind: 'low-value-tags', detail: 'meta.tags missing or empty — no discovery value' })
      else if (m.tags.length === 1 && m.tags[0] === 'auto-authored')
        flags.push({ kind: 'low-value-tags', detail: "tags is exactly ['auto-authored'] — low discovery value" })
    }
    const ticketKey = ticketKeyPrefix(r.name)
    if (ticketKey)
      flags.push({ kind: 'jira-key-named', detail: `filename starts with ${ticketKey} — consider renaming to intent-named` })
    if (flags.length) out.flagged.push({ file: r.file, name: r.name, flags })
  }

  // Overlap: identical flow + phase
  const flowPhaseMap = new Map()
  for (const r of records) {
    if (!r.meta || !r.meta.flow) continue
    const key = `${r.meta.flow}::${r.meta.phase || ''}`
    if (!flowPhaseMap.has(key)) flowPhaseMap.set(key, [])
    flowPhaseMap.get(key).push(r.name)
  }
  for (const [key, names] of flowPhaseMap) {
    if (names.length > 1) {
      const [flow, phase] = key.split('::')
      out.overlapClusters.byFlowPhase.push({ flow, phase: phase || null, snippets: names })
    }
  }

  // Overlap: description explicitly names another snippet AND uses
  // overlap-signalling language ("instead", "alternative", "fork of",
  // "rather than", "supersedes"). "Compose after X" / "intended after X"
  // is NOT overlap — it's documented composition; skip those.
  const allNames = new Set(records.map(r => r.name))
  const overlapSignal = /\b(instead|alternative|alternate|fork of|rather than|supersedes|replaces|in place of|deprecates|superceded|use .* instead)\b/i
  for (const r of records) {
    if (!r.meta || !r.meta.description) continue
    const desc = String(r.meta.description)
    if (!overlapSignal.test(desc)) continue
    for (const other of allNames) {
      if (other === r.name) continue
      if (!desc.includes(other)) continue
      // Try to capture the sentence containing the reference for context.
      const sentence = desc.split(/(?<=[.!?])\s+/).find(s => s.includes(other)) || desc
      out.overlapClusters.byDescription.push({
        snippets: [r.name, other],
        similarity: 'self-referenced-alternative',
        descriptions: [sentence.slice(0, 200), `(${r.name}'s description names ${other} as a related-but-different snippet)`],
      })
    }
  }

  // Overlap: description Jaccard > 0.7
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i], b = records[j]
      if (a.descTokens.size < 3 || b.descTokens.size < 3) continue
      const sim = jaccard(a.descTokens, b.descTokens)
      if (sim >= 0.7) {
        out.overlapClusters.byDescription.push({
          snippets: [a.name, b.name],
          similarity: Number(sim.toFixed(2)),
          descriptions: [
            (a.meta && a.meta.description || '').slice(0, 120),
            (b.meta && b.meta.description || '').slice(0, 120),
          ],
        })
      }
    }
  }

  // Overlap: shared distinctive selectors. Two snippets that both touch the
  // same `#elementId` family (e.g. `#firstName0`/`#firstName1`/...) are
  // likely operating on the same DOM region and may have forked.
  const selectorFamilies = new Map() // family -> [{ name, full }]
  for (const r of records) {
    if (!r.src) continue
    const matches = [...r.src.matchAll(/`#([a-zA-Z][a-zA-Z0-9_-]*?)\$\{[^}]+\}`/g)]
    const families = new Set(matches.map(m => m[1]))
    for (const fam of families) {
      if (!selectorFamilies.has(fam)) selectorFamilies.set(fam, [])
      selectorFamilies.get(fam).push(r.name)
    }
  }
  for (const [family, names] of selectorFamilies) {
    if (names.length > 1) {
      out.overlapClusters.byBody.push({
        snippets: names,
        sharedSelectorFamily: `#${family}\${i}`,
        evidence: `both snippets target the \`#${family}<index>\` input family — likely operate on the same DOM region`,
      })
    }
  }

  // Overlap: shared contiguous body lines. Every snippet shares the schema's
  // skeleton (the run() signature, the arg destructure, the arg guard), so a
  // raw line count clusters most of the library on boilerplate; only shared
  // lines that DO something count toward the threshold — 3 shared actions is
  // rare by coincidence.
  const SKELETON_LINE = /^(export async function run\b|const \{[^}]*\} = args|if \(!\w+\) throw new Error\()/
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i], b = records[j]
      if (!a.bodyLines.length || !b.bodyLines.length) continue
      const { len, start } = longestSharedRun(a.bodyLines, b.bodyLines)
      if (len < 4) continue
      const run = a.bodyLines.slice(start, start + len)
      const meaningful = run.filter(l => !SKELETON_LINE.test(l))
      if (meaningful.length < 3) continue
      out.overlapClusters.byBody.push({
        snippets: [a.name, b.name],
        sharedLines: len,
        preview: meaningful.slice(0, 3).join(' / ').slice(0, 160),
      })
    }
  }

  return out
}

// --- hints scan ---

function splitSections(md) {
  // Segment a hint file into sections. A section starts at any `## ` or `### `
  // heading, OR at a top-level bullet that begins a "named gotcha" (bold-led
  // list item like `- **Foo.** …`). Returns [{heading, startLine, body}, ...].
  const lines = md.split('\n')
  const sections = []
  let cur = null

  const isHeading = (l) => /^#{2,3}\s+/.test(l)
  const isNamedBullet = (l) => /^-\s+\*\*[^*]+\*\*/.test(l)

  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^```/.test(l)) inFence = !inFence
    const starts = !inFence && (isHeading(l) || isNamedBullet(l))
    if (starts) {
      if (cur) sections.push(cur)
      const heading = l.replace(/^#+\s+/, '').replace(/^-\s+\*\*([^*]+)\*\*.*$/, '$1').trim()
      cur = { heading: heading.slice(0, 120), startLine: i + 1, body: l + '\n' }
    } else if (cur) {
      cur.body += l + '\n'
    }
  }
  if (cur) sections.push(cur)
  return sections
}

function detectCodeShaped(body) {
  // Fenced code block > 3 lines.
  const fenceMatches = [...body.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)]
  for (const m of fenceMatches) {
    const inner = m[1].split('\n').filter(l => l.trim() !== '')
    if (inner.length > 3) return { kind: 'fenced', lineCount: inner.length, preview: inner.slice(0, 2).join(' / ').slice(0, 160) }
  }
  // Indented code (4+ spaces or tab) totalling > 80 chars of monospace outside fences.
  let indented = ''
  let inFence = false
  for (const l of body.split('\n')) {
    if (/^```/.test(l)) { inFence = !inFence; continue }
    if (inFence) continue
    if (/^(    |\t)/.test(l)) indented += l + '\n'
  }
  if (indented.length > 80) return { kind: 'indented', charCount: indented.length, preview: indented.slice(0, 160) }
  return null
}

function detectFixtureData(body) {
  // Section reads like a static fixture / regression-data block: a series of
  // `Key: value` bullets where values contain literal-looking identifiers
  // (UUIDs, numeric IDs, named persons, specific tokens) and the section has
  // NO commands or procedure shape.
  const uuidLike = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(body)
  const labelledBullets = (body.match(/^\s*-\s+[A-Z][A-Za-z ]+:\s+/gm) || []).length
  const namedIds = (body.match(/\b(ID|id|UUID)\b/g) || []).length
  if (labelledBullets >= 3 && (uuidLike || namedIds >= 2)) {
    return { kind: 'fixture-data', labelledBullets, hasUuid: uuidLike }
  }
  return null
}

function detectProcedureShaped(body) {
  // Step-by-step with deterministic commands: numbered "1. / 2." steps OR multiple shell-command lines.
  const numberedSteps = [...body.matchAll(/^\s*\d+\.\s+\S/gm)].length
  const shellishLines = body.split('\n').filter(l => /^\s*\$\s/.test(l) || /^\s{0,3}(node|bash|sh|npm|yarn|pnpm|psql|sqlcmd|curl|git|tmux|playwright-cli|direnv|cd|rm|mv|cp|export|source)\s/.test(l)).length
  if (numberedSteps >= 2 && shellishLines >= 1) return { kind: 'numbered-with-shell', numberedSteps, shellishLines }
  if (shellishLines >= 3) return { kind: 'shell-procedure', shellishLines }
  return null
}

function tokenizeProse(body) {
  // Strip code fences before tokenising — code substrings would otherwise
  // dominate cross-file matching with false positives.
  const stripped = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  return stripped
}

function detectCrossFileDupes(section, otherFiles) {
  // Find any contiguous prose substring of >40 chars from this section that
  // appears verbatim in another hint file's prose. Scan sliding windows of
  // length 50 — coarse but bounded.
  const prose = tokenizeProse(section.body).replace(/\s+/g, ' ').trim()
  if (prose.length < 50) return []
  const matches = []
  const seenFiles = new Set()
  const windowSize = 50
  for (let i = 0; i < prose.length - windowSize; i += 10) {
    const needle = prose.slice(i, i + windowSize)
    if (needle.trim().length < 40) continue
    for (const other of otherFiles) {
      if (seenFiles.has(other.file)) continue
      const otherProse = tokenizeProse(other.body).replace(/\s+/g, ' ')
      if (otherProse.includes(needle)) {
        matches.push({ otherFile: other.file, quote: needle.trim().slice(0, 120) })
        seenFiles.add(other.file)
      }
    }
    if (matches.length >= 3) break
  }
  return matches
}

// Verbs the curator's naming schema starts snippets with. A kebab token whose
// first word isn't one of these (`k-selection-multiple`, `intl-tel-input`,
// `data-rbd-droppable-id`) is a CSS class or library attribute, not a snippet.
const SNIPPET_VERBS = new Set([
  'navigate', 'goto', 'click', 'fill', 'submit', 'count', 'read', 'create',
  'delete', 'register', 'advance', 'back', 'open', 'scroll', 'switch',
  'extract', 'find', 'add', 'set', 'enable', 'disable', 'select', 'search',
])

function detectOrphanRefs(body, snippetNames) {
  // Backtick-wrapped names that look like snippet names but don't exist.
  // Kebab shape alone over-matches (CSS classes, library attributes), so
  // require corroboration: the token starts with a snippet verb, or the
  // surrounding text is talking about snippets.
  const orphans = []
  const seen = new Set()
  for (const m of body.matchAll(/`([a-z][a-z0-9-]{4,})`/g)) {
    const r = m[1]
    if (seen.has(r)) continue
    seen.add(r)
    if ((r.match(/-/g) || []).length < 2) continue
    if (snippetNames.has(r)) continue
    if (/\.(ts|js|md|sh|sql)$/.test(r)) continue
    const context = body.slice(Math.max(0, m.index - 80), m.index + r.length + 80)
    if (!SNIPPET_VERBS.has(r.split('-')[0]) && !/snippet|invoke|compose|\.ts\b/i.test(context)) continue
    orphans.push(r)
    if (orphans.length >= 5) break
  }
  return orphans
}

function scanHints(hintsDir, snippetNames) {
  const out = { files: [], sections: [] }
  if (!existsSync(hintsDir) || !statSync(hintsDir).isDirectory()) {
    return { ...out, error: `no hints/ directory at ${hintsDir}` }
  }
  const entries = readdirSync(hintsDir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort()

  // First pass: load all files (needed for cross-file dupe lookup).
  const loaded = []
  for (const file of entries) {
    const fullPath = join(hintsDir, file)
    let src, mtime
    try {
      src = readFileSync(fullPath, 'utf8')
      mtime = statSync(fullPath).mtime.toISOString()
    } catch (e) {
      out.files.push({ file, error: `read failed: ${e.message}` })
      continue
    }
    const lineCount = src.split('\n').length
    const bulletCount = (src.match(/^\s*[-*]\s+/gm) || []).length
    out.files.push({ file, lineCount, bulletCount, mtime })
    loaded.push({ file, body: src })
  }

  // Second pass: section-level lint.
  for (const { file, body } of loaded) {
    const sections = splitSections(body)
    const others = loaded.filter(o => o.file !== file)
    for (const sec of sections) {
      const flags = []
      const codeShaped = detectCodeShaped(sec.body)
      if (codeShaped) flags.push({ kind: 'code-shaped', ...codeShaped })
      const proc = detectProcedureShaped(sec.body)
      if (proc) flags.push({ kind: 'procedure-shaped', ...proc })
      const fixture = detectFixtureData(sec.body)
      if (fixture) flags.push({ kind: 'fixture-data', ...fixture })
      const dupes = detectCrossFileDupes(sec, others)
      if (dupes.length) flags.push({ kind: 'cross-file-dupe', matches: dupes })
      const orphans = detectOrphanRefs(sec.body, snippetNames)
      if (orphans.length) flags.push({ kind: 'orphan-reference', missing: orphans })

      // TODO-masquerading: prose that says a snippet needs fixing.
      const todoLike = /needs (this|the) fix applied|TODO|candidate for delete|workaround until|once the snippet is fixed/i.test(sec.body)
      if (todoLike) flags.push({ kind: 'todo-masquerade', detail: 'section reads like a TODO about a snippet rather than a stable gotcha' })

      if (flags.length) {
        out.sections.push({
          file,
          heading: sec.heading,
          startLine: sec.startLine,
          quote: sec.body.replace(/\s+/g, ' ').trim().slice(0, 160),
          flags,
        })
      }
    }
  }

  return out
}

// --- the scan flow ---

async function run() {
const report = {
  forgeRoot,
  scope,
  generatedAt: new Date().toISOString(),
}

if (scope === 'snippets' || scope === 'both') {
  // Regenerate INDEX.md first so the lead acts on fresh data.
  try {
    const { spawnSync } = await import('node:child_process')
    const forgeCli = join(dirname(new URL(import.meta.url).pathname), '..', 'forge-cli.mjs')
    const r = spawnSync(process.execPath, [forgeCli, 'snippet-index', forgeRoot], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error((r.stderr || 'index refresh failed').trim())
    report.indexRefreshed = true
    // The index script reports library hygiene on stderr (empty tags, missing
    // meta, multi-step descriptions without flow/phase) — surface it in the
    // report rather than swallowing it; the clean route folds it into the
    // shortlist and the final summary.
    const warnings = (r.stderr || '').split('\n').map(l => l.trim()).filter(Boolean)
      .filter(l => !/re-run with --verbose/.test(l))
    if (warnings.length) report.indexWarnings = warnings.slice(0, 10)
  } catch (e) {
    report.indexRefreshed = false
    report.indexRefreshError = e.message
  }
  report.snippets = scanSnippets(join(forgeRoot, 'snippets'))
}

const snippetNames = new Set()
if (report.snippets) {
  for (const f of report.snippets.files) {
    if (f.name) snippetNames.add(f.name)
  }
}

if (scope === 'hints' || scope === 'both') {
  // If scope is hints-only, we still want snippet names for orphan-reference detection.
  if (snippetNames.size === 0) {
    const snippetsDir = join(forgeRoot, 'snippets')
    if (existsSync(snippetsDir)) {
      for (const f of readdirSync(snippetsDir)) {
        if (f.endsWith('.ts')) snippetNames.add(basename(f, '.ts'))
      }
    }
  }
  report.hints = scanHints(join(forgeRoot, 'hints'), snippetNames)
}

// Note on staleness file.
const stalenessPath = join(forgeRoot, '.last-cleanup')
report.stalenessFile = {
  path: stalenessPath,
  exists: existsSync(stalenessPath),
}
if (report.stalenessFile.exists) {
  try {
    report.stalenessFile.contents = JSON.parse(readFileSync(stalenessPath, 'utf8'))
  } catch (e) {
    report.stalenessFile.parseError = e.message
  }
}

process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}
