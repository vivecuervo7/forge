#!/usr/bin/env node
// forge-export-spec.mjs — export a composed forge spec to a self-contained,
// inlined form suitable for shipping into another test suite (or sharing as
// a single-file artifact).
//
// The composed form (what spec-writer produces) imports from forge/snippets/
// and calls `<snippet>.run(page, args)` for each step. That form is great for
// working artifacts because it auto-evolves with the library, but it can't
// be lifted into a project's e2e-tests/ directory without bringing forge's
// snippet layout along.
//
// This script transforms a composed spec into an inlined spec:
//   - Strips `import * as X from '../snippets/Y'` lines
//   - Replaces each `await X.run(page, args)` call site with an inlined
//     block containing the snippet's run body
//   - For capturing calls (`const x = await X.run(page, args)`), wraps the
//     inlined body in an async IIFE so the snippet's `return` reaches the
//     outer variable
//   - Adds a header comment naming the source spec, date, and snippets
//
// The exported spec is a snapshot — it will NOT auto-update when the
// underlying snippets change. Re-run forge-export-spec.mjs to refresh.
//
// Approach: hand-rolled paren/brace matching, no AST parser dependency.
// Forge specs follow a strict, predictable shape (the spec-writer agent
// emits them); we lean on that shape rather than handling arbitrary TS.
//
// Usage:
//   forge-export-spec.mjs --spec <path> --output <path> [--force]
//
// Exit codes:
//   0   success
//   2   usage / arg error
//   4   spec file not found
//   5   output exists (use --force)
//   6   no snippet imports found in spec (already inlined?)
//   7   snippet referenced by spec couldn't be found / parsed

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, relative, basename } from 'node:path'

function die(msg, code = 2) {
  console.error('forge-export-spec:', msg)
  process.exit(code)
}

// ---- args ----------------------------------------------------------------

const argv = process.argv.slice(2)
let specPath = null
let outputPath = null
let force = false

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--spec') {
    if (i + 1 >= argv.length) die('--spec requires a path')
    specPath = argv[++i]
  } else if (arg === '--output') {
    if (i + 1 >= argv.length) die('--output requires a path')
    outputPath = argv[++i]
  } else if (arg === '--force' || arg === '-f') {
    force = true
  } else {
    die(`unknown arg: ${arg}`)
  }
}

if (!specPath) die('missing --spec <path>')
if (!outputPath) die('missing --output <path>')

specPath = resolve(specPath)
outputPath = resolve(outputPath)

if (!existsSync(specPath)) die(`spec not found: ${specPath}`, 4)
if (existsSync(outputPath) && !force) {
  die(`output exists: ${outputPath} — use --force to overwrite`, 5)
}

// ---- helpers -------------------------------------------------------------

function findMatchingClose(text, openIdx, openChar, closeChar) {
  let depth = 1
  let i = openIdx + 1
  while (i < text.length && depth > 0) {
    const c = text[i]
    if (c === openChar) depth++
    else if (c === closeChar) {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

function extractSnippetBody(snippetContent, snippetName) {
  // Find: export async function run(page, args) {
  const re = /export\s+async\s+function\s+run\s*\(\s*page\s*,\s*args\s*\)\s*\{/
  const m = snippetContent.match(re)
  if (!m) {
    die(
      `snippet "${snippetName}" does not have a standard ` +
      `\`export async function run(page, args) { ... }\` signature`,
      7
    )
  }
  const openBraceIdx = m.index + m[0].length - 1
  const closeBraceIdx = findMatchingClose(snippetContent, openBraceIdx, '{', '}')
  if (closeBraceIdx === -1) die(`snippet "${snippetName}" has unbalanced braces`, 7)
  const raw = snippetContent.slice(openBraceIdx + 1, closeBraceIdx).replace(/^\n/, '').replace(/\n\s*$/, '')
  return dedent(raw)
}

// Strip the common leading whitespace from all non-empty lines so the body
// is "flush left" — then the caller can re-indent to the target depth.
function dedent(text) {
  const lines = text.split('\n')
  let minIndent = Infinity
  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = line.match(/^[ \t]*/)[0].length
    if (indent < minIndent) minIndent = indent
  }
  if (minIndent === Infinity || minIndent === 0) return text
  return lines.map(line => line.length >= minIndent ? line.slice(minIndent) : line).join('\n')
}

function indentLines(text, indent) {
  return text.split('\n').map(line => line.length > 0 ? indent + line : line).join('\n')
}

// ---- read spec, find imports --------------------------------------------

const specContent = readFileSync(specPath, 'utf8')
const specDir = dirname(specPath)
const forgeRoot = dirname(specDir)

// Match: import * as VAR from '../snippets/NAME'
const importRe = /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]\.\.\/snippets\/([\w-]+)['"]\s*;?\s*$/gm

const imports = []
let m
while ((m = importRe.exec(specContent)) !== null) {
  imports.push({
    varName: m[1],
    snippetName: m[2],
    fullLine: m[0],
    lineStartIdx: m.index,
  })
}

if (imports.length === 0) {
  die('no snippet imports of the form `import * as X from \'../snippets/Y\'` found — already inlined?', 6)
}

// ---- load snippet bodies -------------------------------------------------

const snippetBodies = new Map()
for (const { snippetName } of imports) {
  if (snippetBodies.has(snippetName)) continue
  const snippetPath = resolve(forgeRoot, 'snippets', `${snippetName}.ts`)
  if (!existsSync(snippetPath)) {
    die(`snippet "${snippetName}" referenced by spec not found at ${snippetPath}`, 7)
  }
  const content = readFileSync(snippetPath, 'utf8')
  snippetBodies.set(snippetName, extractSnippetBody(content, snippetName))
}

// ---- find each call site, replace -----------------------------------------

// A "call site" is an occurrence of `<varName>.run(page,` followed by an args
// expression and a closing paren, optionally preceded by `(const|let|var) X =`
// and an `await`. We scan the spec for each varName's calls, computing
// (startOfStatement, endOfStatement, argsExpr, captureVar?), then replace
// each site with the inlined block.

function findCallSites(content, varName) {
  const sites = []
  const callMarker = `${varName}.run(page`
  let from = 0
  while (true) {
    const idx = content.indexOf(callMarker, from)
    if (idx === -1) break

    // The `(` after .run — find matching `)`
    const openParenIdx = content.indexOf('(', idx + varName.length + '.run'.length)
    const closeParenIdx = findMatchingClose(content, openParenIdx, '(', ')')
    if (closeParenIdx === -1) {
      from = idx + callMarker.length
      continue
    }

    // The args expression is everything between the comma after `page` and the
    // close paren. Find the FIRST `,` after openParenIdx at depth 0 of nested
    // parens/braces — that's the page/args separator.
    let depth = 0
    let commaIdx = -1
    for (let i = openParenIdx + 1; i < closeParenIdx; i++) {
      const c = content[i]
      if (c === '(' || c === '{' || c === '[') depth++
      else if (c === ')' || c === '}' || c === ']') depth--
      else if (c === ',' && depth === 0) { commaIdx = i; break }
    }
    let argsExpr = '{}'
    if (commaIdx !== -1) {
      argsExpr = content.slice(commaIdx + 1, closeParenIdx).trim()
      if (argsExpr === '') argsExpr = '{}'
    }

    // Look backwards from idx for `await ` (which must precede the call).
    // Then before that, look for `(const|let|var)\s+(\w+)\s*=\s*$` to detect
    // a capturing assignment.
    const awaitRe = /\bawait\s+$/
    const beforeCall = content.slice(0, idx)
    if (!awaitRe.test(beforeCall)) {
      from = closeParenIdx + 1
      continue
    }
    const awaitMatch = beforeCall.match(awaitRe)
    const awaitStartIdx = awaitMatch.index

    // Scan back further for an assignment.
    const beforeAwait = content.slice(0, awaitStartIdx)
    const assignRe = /(?:^|\n)(\s*)(const|let|var)\s+(\w+)\s*=\s*$/
    const assignMatch = beforeAwait.match(assignRe)
    let statementStart, captureDecl = null, captureVar = null, indent = ''
    if (assignMatch) {
      statementStart = assignMatch.index + (assignMatch[0].startsWith('\n') ? 1 : 0)
      indent = assignMatch[1]
      captureDecl = assignMatch[2]
      captureVar = assignMatch[3]
    } else {
      // No assignment — scan back to the start of the statement (previous \n
      // or beginning of file, then skip leading whitespace).
      const lastNl = beforeAwait.lastIndexOf('\n')
      statementStart = lastNl === -1 ? 0 : lastNl + 1
      const leadingWs = content.slice(statementStart).match(/^[ \t]*/)
      indent = leadingWs ? leadingWs[0] : ''
    }

    // Find end of statement — include optional trailing semicolon.
    let statementEnd = closeParenIdx + 1
    if (content[statementEnd] === ';') statementEnd++

    sites.push({
      varName,
      argsExpr,
      captureDecl,
      captureVar,
      indent,
      statementStart,
      statementEnd,
    })

    from = closeParenIdx + 1
  }
  return sites
}

// Collect all sites for all imports, sort by start position descending so
// replacement doesn't invalidate later indices.
const allSites = []
for (const { varName, snippetName } of imports) {
  for (const site of findCallSites(specContent, varName)) {
    allSites.push({ ...site, snippetName })
  }
}
allSites.sort((a, b) => b.statementStart - a.statementStart)

let output = specContent

for (const site of allSites) {
  const body = snippetBodies.get(site.snippetName)
  const innerIndent = site.indent + '  '
  const indentedBody = indentLines(body, innerIndent)
  let replacement
  if (site.captureVar) {
    // const X = await (async () => { const args = ...; <body> })()
    replacement =
      `${site.indent}${site.captureDecl} ${site.captureVar} = await (async () => {\n` +
      `${innerIndent}const args = ${site.argsExpr};\n` +
      `${indentedBody}\n` +
      `${site.indent}})()`
  } else {
    // { const args = ...; <body> }
    replacement =
      `${site.indent}{\n` +
      `${innerIndent}const args = ${site.argsExpr};\n` +
      `${indentedBody}\n` +
      `${site.indent}}`
  }
  output = output.slice(0, site.statementStart) + replacement + output.slice(site.statementEnd)
}

// ---- strip snippet import lines -----------------------------------------

for (const { fullLine } of imports) {
  // Match the line with optional trailing newline.
  const escaped = fullLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  output = output.replace(new RegExp('^' + escaped + '\\n?', 'm'), '')
}

// ---- add header comment --------------------------------------------------

const date = new Date().toISOString().split('T')[0]
const snippetList = [...new Set(imports.map(i => i.snippetName))].join(', ')
const sourceRel = relative(dirname(outputPath), specPath) || basename(specPath)

const header =
  `// Exported from ${sourceRel} on ${date} by forge-export-spec.mjs.\n` +
  `// Inlined snippets: ${snippetList}.\n` +
  `// This is a self-contained snapshot — re-run forge-export-spec.mjs to refresh\n` +
  `// after the underlying snippets change.\n` +
  `//\n`

output = header + output

// ---- write ---------------------------------------------------------------

writeFileSync(outputPath, output)

console.log(`forge-export-spec: exported ${specPath} → ${outputPath}`)
console.log(`  Inlined ${imports.length} import(s), ${allSites.length} call site(s).`)
console.log(`  Snippets: ${snippetList}`)
