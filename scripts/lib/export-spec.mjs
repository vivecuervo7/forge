// export-spec — export a composed forge spec to a self-contained, inlined
// form suitable for shipping into another test suite (or sharing as a
// single-file artifact).
//
// The composed form (what the driver produces) imports from forge/snippets/.
// That form is great for a working artifact because it auto-evolves with the
// library, but it can't be lifted into a project's e2e-tests/ directory
// without bringing forge's snippet layout along.
//
// Approach: each module in the spec's transitive closure becomes ONE
// module-scoped IIFE whose body is the snippet's source VERBATIM, and whose
// inter-snippet dependencies are injected by destructuring the modules it
// imported from:
//
//   const $escapeRegex = (() => {
//     function escapeRegex(str) { ... }        // verbatim
//     return { escapeRegex }
//   })()
//
//   const $addItemToCart = (() => {
//     const { escapeRegex } = $escapeRegex     // injected dependency
//     async function run(page, args) { ... }   // verbatim
//     return { run }
//   })()
//
// The spec's own import lines then become plain bindings off those consts
// (`const addItemToCart = $addItemToCart.run`), so the spec body is never
// rewritten — every call site, selector and assertion survives byte-for-byte.
//
// Why whole-module IIFEs rather than splicing each `run()` body into its call
// site (which is what this verb used to do):
//
//   - `run` is not unique. Every snippet defines one, so any closure holding
//     two snippets has a name collision that splicing must paper over.
//   - A snippet's `run` is frequently a one-line delegator to a sibling export
//     in the same file (`return login(page, args)`). Splicing just that body
//     drops the sibling AND lands a bare `return` inside the test's own
//     function, so the test exits early and reports GREEN having asserted
//     nothing — a false pass, which is worse than a hard failure.
//   - Snippets import other snippets. Splicing one body pulls in identifiers
//     that live in modules nobody inlined.
//
// Wrapping whole modules makes all three structural rather than heuristic:
// names stay module-scoped, siblings come along, and the closure is walked.
//
// Type/interface/`declare` declarations are lifted to the file's top level —
// they are compile-time only, and both `export` and `declare` are illegal
// inside a function body.
//
// The exported spec is a snapshot: it will NOT track later changes to the
// snippets it was built from. Re-run to refresh.
//
// Approach note: hand-rolled brace matching, no AST parser dependency. Forge
// snippets follow a strict, predictable shape (the curator emits them); we
// lean on that shape rather than handling arbitrary TypeScript.
//
// Usage:
//   forge-cli.mjs export-spec --spec <path> --output <path> [--force]
//
// Exit codes:
//   0   success
//   2   usage / arg error
//   4   spec file not found
//   5   output exists (use --force)
//   6   no snippet imports found in spec (already inlined?)
//   7   a snippet in the closure couldn't be found or parsed
//   8   dependency cycle between snippets

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, relative, basename } from 'node:path'

const USAGE = `usage: forge-cli.mjs export-spec --spec <path> --output <path> [--force]

Inlines a composed spec (and every snippet in its transitive closure) into a
single self-contained file that needs only @playwright/test to run.`

// Carries an exit code out of the pure core so `main` owns all process exits.
class ExportError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

const fail = (msg, code = 7) => {
  throw new ExportError(msg, code)
}

// ---- brace / paren matching ----------------------------------------------

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

// ---- import scanning -----------------------------------------------------

// A whole import statement, single- or multi-line, terminated by its
// `from '<source>'`. The lazy body lets a braced clause span lines.
const IMPORT_FROM_RE = /^import\b([\s\S]*?)\bfrom\s*(['"])([^'"]+)\2[ \t]*;?[ \t]*$/gm
// Side-effect import: `import 'polyfill'`.
const IMPORT_BARE_RE = /^import\s*(['"])([^'"]+)\1[ \t]*;?[ \t]*$/gm

// Parse the clause between `import` and `from` into its bindings.
export function parseImportClause(rawClause) {
  let clause = rawClause.trim()
  let typeOnly = false
  if (/^type\b/.test(clause)) {
    typeOnly = true
    clause = clause.replace(/^type\b/, '').trim()
  }

  const result = { typeOnly, namespace: null, defaultName: null, named: [] }

  const nsMatch = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/)
  if (nsMatch) {
    result.namespace = nsMatch[1]
    return result
  }

  const braceStart = clause.indexOf('{')
  if (braceStart === -1) {
    if (clause) result.defaultName = clause
    return result
  }

  const beforeBrace = clause.slice(0, braceStart).replace(/,\s*$/, '').trim()
  if (beforeBrace) result.defaultName = beforeBrace

  const inner = clause.slice(braceStart + 1, clause.lastIndexOf('}'))
  for (const part of inner.split(',')) {
    const spec = part.trim()
    if (!spec) continue
    const asMatch = spec.match(/^(?:type\s+)?([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
    if (asMatch) {
      result.named.push({ imported: asMatch[1], local: asMatch[2] })
      continue
    }
    const plain = spec.replace(/^type\s+/, '')
    if (/^[A-Za-z_$][\w$]*$/.test(plain)) result.named.push({ imported: plain, local: plain })
  }
  return result
}

function scanImports(src) {
  const found = []
  IMPORT_FROM_RE.lastIndex = 0
  let m
  while ((m = IMPORT_FROM_RE.exec(src)) !== null) {
    found.push({
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      source: m[3],
      clause: parseImportClause(m[1]),
    })
  }
  IMPORT_BARE_RE.lastIndex = 0
  while ((m = IMPORT_BARE_RE.exec(src)) !== null) {
    found.push({
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      source: m[2],
      clause: null,
    })
  }
  return found.sort((a, b) => a.start - b.start)
}

// A snippet reference is `./name` (snippet → snippet) or `../snippets/name`
// (spec → snippet). Anything else is an external package.
function snippetRefName(source) {
  return (
    source.match(/^\.\/([\w-]+)$/)?.[1] ?? source.match(/^\.\.\/snippets\/([\w-]+)$/)?.[1] ?? null
  )
}

// ---- module analysis -----------------------------------------------------

// Remove `[export] const meta = { ... }` — library metadata with no business
// in a shipped spec.
function stripMeta(src) {
  const m = src.match(/^(?:export\s+)?const\s+meta\s*=\s*\{/m)
  if (!m) return src
  const openIdx = m.index + m[0].length - 1
  const closeIdx = findMatchingClose(src, openIdx, '{', '}')
  if (closeIdx === -1) return src
  let end = closeIdx + 1
  if (src[end] === ';') end++
  return src.slice(0, m.index) + src.slice(end).replace(/^\n+/, '\n')
}

const COMMENT_LINE = /^\s*\/\//

// Which lines BEGIN inside a template literal. Comment stripping is line-based,
// so without this a `// …` line that is really injected-script source (snippets
// pass script text to addInitScript/evaluate) would be deleted — changing
// behaviour while still compiling cleanly.
//
// A hand-rolled scanner tracking strings, comments and `${}` nesting. Regex
// literals are deliberately not modelled: distinguishing `/` as division from a
// regex needs real parsing, and a regex would only mislead this scanner if it
// contained a quote or backtick, which is vanishingly rare in snippet code.
export function templateLiteralLines(src) {
  const inside = new Set()
  // Brace counters for each `${…}` expression we've descended into; a non-empty
  // stack means an enclosing template is waiting for us to come back out.
  const exprStack = []
  let state = 'code'
  let line = 0

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]

    if (c === '\n') {
      line++
      if (state === 'tpl') inside.add(line)
      if (state === 'line-comment') state = 'code'
      continue
    }

    if (state === 'code') {
      if (c === '\\') i++
      else if (c === '/' && n === '/') { state = 'line-comment'; i++ }
      else if (c === '/' && n === '*') { state = 'block-comment'; i++ }
      else if (c === "'") state = 'single'
      else if (c === '"') state = 'double'
      else if (c === '`') state = 'tpl'
      else if (exprStack.length && c === '{') exprStack[exprStack.length - 1]++
      else if (exprStack.length && c === '}') {
        if (exprStack[exprStack.length - 1] === 0) {
          exprStack.pop()
          state = 'tpl'
        } else exprStack[exprStack.length - 1]--
      }
    } else if (state === 'block-comment') {
      if (c === '*' && n === '/') { state = 'code'; i++ }
    } else if (state === 'single' || state === 'double') {
      if (c === '\\') i++
      else if ((state === 'single' && c === "'") || (state === 'double' && c === '"')) state = 'code'
    } else if (state === 'tpl') {
      if (c === '\\') i++
      else if (c === '`') state = 'code'
      else if (c === '$' && n === '{') { exprStack.push(0); state = 'code'; i++ }
    }
  }
  return inside
}
// Markers that open a curation note rather than an explanation. Grounded in the
// library's actual leading words; `Authored`/`PATCHED` alone account for most of
// it. Deliberately excludes hedged words like `Confirmed` and `NOTE`, which lead
// genuine caveats as often as bookkeeping.
const PROVENANCE = /^\s*\/\/\s*(authored|patched|fixed|refactored|updated|split|extracted|renamed|re-verified|rewritten|superseded)\b/i

// A snippet's leading comment region is its library documentation — who authored
// it, how to call it, how it has been patched. Useful in the library, noise in a
// shipped artifact, so the whole region goes: consecutive comment and blank
// lines from the top of the module until the first line of actual code.
export function stripLeadingDocBlock(src) {
  const lines = src.split('\n')
  const inTemplate = templateLiteralLines(src)
  let i = 0
  while (
    i < lines.length &&
    !inTemplate.has(i) &&
    (COMMENT_LINE.test(lines[i]) || lines[i].trim() === '')
  ) {
    i++
  }
  return lines.slice(i).join('\n')
}

// Curation narrative that sits deeper in the body — accreted patch notes
// addressed to whoever maintains the snippet next. A block is dropped whole when
// its FIRST line opens with a provenance marker; blocks that merely mention a
// date or ticket further in stay, since those are usually explaining a
// constraint rather than logging a change.
export function stripProvenanceBlocks(src) {
  const lines = src.split('\n')
  const inTemplate = templateLiteralLines(src)
  const isComment = (i) => COMMENT_LINE.test(lines[i]) && !inTemplate.has(i)

  const keep = []
  for (let i = 0; i < lines.length; i++) {
    if (!isComment(i)) {
      keep.push(lines[i])
      continue
    }
    const start = i
    while (i + 1 < lines.length && isComment(i + 1)) i++
    if (PROVENANCE.test(lines[start])) continue
    keep.push(...lines.slice(start, i + 1))
  }
  return keep.join('\n')
}

// Catalogue the module's `type` / `interface` declarations and drop their
// `export` keyword, but leave them where they sit: TypeScript allows a type
// alias or interface inside a function body, and a type left in place can
// still refer to the module's own locals. Lifting one whose definition reads a
// module-local value (`typeof KNOWN_MODULES[number]`) would strand it out of
// scope, so lifting is reserved for the rare type another module imports —
// see `liftSharedTypes`.
function catalogueTypes(src) {
  const decls = []
  const re = /^(export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(src)) !== null) {
    const declStart = m.index
    const braceIdx = src.indexOf('{', declStart)
    const lineEnd = src.indexOf('\n', declStart)
    let end
    if (braceIdx !== -1 && (lineEnd === -1 || braceIdx < lineEnd)) {
      const closeIdx = findMatchingClose(src, braceIdx, '{', '}')
      end = closeIdx === -1 ? (lineEnd === -1 ? src.length : lineEnd) : closeIdx + 1
    } else {
      end = lineEnd === -1 ? src.length : lineEnd
    }
    decls.push({ name: m[2], text: src.slice(declStart, end).replace(/^export\s+/, '').trim() })
  }

  return { body: src.replace(/^export\s+(?=(?:type|interface)\s)/gm, ''), typeDecls: decls }
}

// `declare` is only legal in an ambient context, never inside a function body,
// so ambient shims (`declare const __dirname: string`) must move to the top
// level. They name globals, so they never depend on module locals.
function liftDeclares(src) {
  const declareRe = /^declare\s+(?:const|let|var|function)\s[^\n]*$/gm
  const declares = (src.match(declareRe) ?? []).map((d) => d.trim())
  return { body: src.replace(declareRe, ''), declares }
}

// Collect the module's exported runtime names, then strip the `export`
// keyword so the declarations are legal inside the IIFE.
function collectExports(src) {
  const names = []
  const declRe = /^export\s+(?:(?:async\s+)?function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = declRe.exec(src)) !== null) names.push(m[1])

  // Bare re-export of local declarations: `export { openFilter }`.
  const bareRe = /^export\s*\{([^}]*)\}[ \t]*;?[ \t]*$/gm
  while ((m = bareRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const spec = part.trim()
      if (!spec) continue
      names.push(spec.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)?.[2] ?? spec)
    }
  }

  const body = src
    .replace(/^export\s+(?=(?:async\s+)?function\s|const\s|let\s|var\s|class\s)/gm, '')
    .replace(bareRe, '')

  return { body, names: [...new Set(names)] }
}

export function analyseModule(name, src) {
  const imports = scanImports(src)

  const deps = []
  const externals = []
  for (const imp of imports) {
    const ref = snippetRefName(imp.source)
    if (ref) deps.push({ module: ref, clause: imp.clause })
    else externals.push(imp)
  }

  // Strip every import statement, back to front so indices stay valid.
  let body = src
  for (const imp of [...imports].reverse()) {
    body = body.slice(0, imp.start) + body.slice(imp.end).replace(/^\n/, '')
  }

  body = stripMeta(body)
  // Library-facing commentary is dropped from the inlined copy. Only the
  // module's own text is touched — the spec's comments are its author's
  // documentation of the scenario and survive intact.
  body = stripProvenanceBlocks(stripLeadingDocBlock(body))
  const { body: afterDeclares, declares } = liftDeclares(body)
  const { body: afterTypes, typeDecls } = catalogueTypes(afterDeclares)
  const { body: afterExports, names } = collectExports(afterTypes)

  return {
    name,
    deps,
    externals,
    declares,
    typeDecls,
    typeNames: typeDecls.map((d) => d.name),
    exportNames: names,
    body: afterExports.replace(/^\n+/, '').replace(/\s+$/, ''),
    isFixtureModule: names.includes('test'),
    raw: src,
  }
}

// ---- closure + ordering --------------------------------------------------

function buildClosure(specImports, loadModule) {
  const modules = new Map()
  const queue = specImports.map((i) => i.module)

  while (queue.length) {
    const name = queue.shift()
    if (modules.has(name)) continue
    const src = loadModule(name)
    if (src == null) fail(`snippet "${name}" is referenced in the closure but could not be found`, 7)
    const mod = analyseModule(name, src)
    modules.set(name, mod)
    // A fixture module's body is discarded in favour of a stub, so walking its
    // dependencies would inline modules nothing in the output calls. Anything
    // the spec itself needs still arrives through the spec's own imports.
    if (mod.isFixtureModule) continue
    for (const dep of mod.deps) if (!modules.has(dep.module)) queue.push(dep.module)
  }
  return modules
}

// Module consts reference each other at definition time, so definition order
// has to follow the dependency graph.
function topoSort(modules) {
  const order = []
  const state = new Map()

  const visit = (name, trail) => {
    const s = state.get(name)
    if (s === 'done') return
    if (s === 'visiting') fail(`dependency cycle between snippets: ${[...trail, name].join(' → ')}`, 8)
    state.set(name, 'visiting')
    for (const dep of modules.get(name).deps) {
      if (modules.has(dep.module)) visit(dep.module, [...trail, name])
    }
    state.set(name, 'done')
    order.push(name)
  }

  for (const name of modules.keys()) visit(name, [])
  return order
}

// A type is only hoisted when something outside its own module names it — a
// sibling snippet or the spec importing it. Anything else stays put, so a type
// defined in terms of its module's locals keeps working.
function liftSharedTypes(modules, specImports, runtimeOrder) {
  const wanted = new Map()
  const note = (moduleName, clause) => {
    if (!clause) return
    for (const b of clause.named) {
      if (!wanted.has(moduleName)) wanted.set(moduleName, new Set())
      wanted.get(moduleName).add(b.imported)
    }
  }

  for (const imp of specImports) note(imp.module, imp.clause)
  for (const mod of modules.values()) for (const dep of mod.deps) note(dep.module, dep.clause)

  const lifted = []
  for (const [moduleName, names] of wanted) {
    if (!runtimeOrder.includes(moduleName)) continue
    const mod = modules.get(moduleName)
    for (const name of names) {
      const decl = mod.typeDecls.find((d) => d.name === name)
      if (!decl) continue
      lifted.push(decl.text)
      mod.body = mod.body.replace(decl.text, '').replace(/\n{3,}/g, '\n\n').trim()
    }
  }
  return lifted
}

// ---- emission ------------------------------------------------------------

const camelize = (kebab) =>
  kebab.replace(/^_+/, '').replace(/-+([a-z0-9])/g, (_, c) => c.toUpperCase())

function assignModuleConsts(order) {
  const consts = new Map()
  const used = new Set()
  for (const name of order) {
    const base = `$${camelize(name)}`
    let candidate = base
    let n = 2
    while (used.has(candidate)) candidate = `${base}${n++}`
    used.add(candidate)
    consts.set(name, candidate)
  }
  return consts
}

// Turn one import clause into runtime binding statements against a module
// const. Type-only bindings produce nothing — those names were hoisted.
function bindingStatements(clause, modConst, targetModule, indent = '') {
  if (!clause) return []
  const out = []
  if (clause.namespace) out.push(`${indent}const ${clause.namespace} = ${modConst}`)

  const runtimeNamed = clause.typeOnly
    ? []
    : clause.named.filter((b) => !(targetModule?.typeNames ?? []).includes(b.imported))

  if (runtimeNamed.length) {
    const parts = runtimeNamed.map((b) =>
      b.imported === b.local ? b.imported : `${b.imported}: ${b.local}`
    )
    out.push(`${indent}const { ${parts.join(', ')} } = ${modConst}`)
  }
  return out
}

const indentBlock = (text, indent) =>
  text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : indent + line))
    .join('\n')

function emitModule(mod, modConst, consts) {
  const rule = '─'.repeat(Math.max(3, 60 - mod.name.length))
  const lines = [`// ── ${mod.name} ${rule}`, `const ${modConst} = (() => {`]

  for (const dep of mod.deps) {
    const depConst = consts.get(dep.module)
    if (!depConst) continue
    lines.push(...bindingStatements(dep.clause, depConst, mod.depModules.get(dep.module), '  '))
  }

  lines.push(indentBlock(mod.body, '  '))
  lines.push(`  return { ${mod.exportNames.join(', ')} }`)
  lines.push('})()')
  return lines.join('\n')
}

const envVarFor = (name) =>
  `FORGE_FIXTURE_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`

// Parse the fixture names out of a `base.extend<...>({ ... })` call — the top
// level keys of its object literal.
export function fixtureNames(src) {
  const m = src.match(/\bextend\s*(?:<[\s\S]*?>)?\s*\(\s*\{/)
  if (!m) return []
  const openIdx = m.index + m[0].length - 1
  const closeIdx = findMatchingClose(src, openIdx, '{', '}')
  if (closeIdx === -1) return []
  const inner = src.slice(openIdx + 1, closeIdx)

  const names = []
  let depth = 0
  let atKey = true
  let buf = ''
  for (const c of inner) {
    if (c === '{' || c === '[' || c === '(') {
      depth++
      continue
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--
      continue
    }
    if (depth > 0) continue
    if (c === ',') {
      atKey = true
      buf = ''
      continue
    }
    if (!atKey) continue
    if (c === ':') {
      const key = buf.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(key)) names.push(key)
      atKey = false
      buf = ''
      continue
    }
    buf += c
  }
  return [...new Set(names)]
}

// A fixture module (one exporting `test`) extends Playwright's base `test`
// with fixtures of its own. Those fixtures routinely reach outside the
// snippet directory — resolving project-local scripts, reading credentials —
// which is exactly what a portable file cannot carry. Replace each with an
// env-var stub that throws a named error, so the gap is loud at run time
// rather than silently absent.
function emitFixtureStub(mod, warnings) {
  const names = fixtureNames(mod.raw)
  if (!names.length) {
    warnings.push(
      `fixture module "${mod.name}" exports \`test\` but no fixtures could be parsed — ` +
        `the export falls back to Playwright's base \`test\`.`
    )
    return `const test = base`
  }

  warnings.push(
    `fixture module "${mod.name}" was NOT inlined — its fixture(s) ` +
      `${names.map((n) => `\`${n}\``).join(', ')} reach outside snippets/ and can't travel in a ` +
      `portable file. Each is replaced by a stub that throws until you set ` +
      `${names.map(envVarFor).join(' / ')} or wire your own fixture.`
  )

  const typeParams = `{}, { ${names.map((n) => `${n}: any`).join('; ')} }`
  const body = names
    .map((n) => {
      const envVar = envVarFor(n)
      return [
        `  ${n}: [`,
        `    async ({}, use) => {`,
        `      const raw = process.env.${envVar}`,
        `      if (!raw) {`,
        `        throw new Error(`,
        `          "exported spec: the '${n}' fixture came from '${mod.name}', which export " +`,
        `          "could not inline. Set ${envVar} to a JSON value, or replace this stub " +`,
        `          "with your own fixture."`,
        `        )`,
        `      }`,
        `      await use(JSON.parse(raw))`,
        `    },`,
        `    { scope: 'worker' },`,
        `  ],`,
      ].join('\n')
    })
    .join('\n')

  const rule = '─'.repeat(Math.max(3, 40 - mod.name.length))
  return [
    `// ── fixture stub, replacing ${mod.name} ${rule}`,
    `// export could not carry this fixture module: its fixtures resolve paths or`,
    `// credentials outside snippets/. Supply the value via env, or replace the stub.`,
    `const test = base.extend<${typeParams}>({`,
    body,
    `})`,
  ].join('\n')
}

// Merge every external import across the spec and the inlined modules into a
// single import block.
function mergeExternalImports(externals, needsBaseTest) {
  const bySource = new Map()
  const slot = (source) => {
    if (!bySource.has(source)) {
      bySource.set(source, {
        namespaces: new Set(),
        named: new Map(),
        typeNamed: new Map(),
        bare: false,
      })
    }
    return bySource.get(source)
  }

  for (const imp of externals) {
    const s = slot(imp.source)
    if (!imp.clause) {
      s.bare = true
      continue
    }
    if (imp.clause.namespace) s.namespaces.add(imp.clause.namespace)
    if (imp.clause.defaultName) s.named.set('default', imp.clause.defaultName)
    // Keep `import type` separate rather than folding the name into a value
    // clause: under verbatimModuleSyntax a type in a value import is an error,
    // and the erasure only happens reliably when it's declared as a type.
    const target = imp.clause.typeOnly ? s.typeNamed : s.named
    for (const b of imp.clause.named) target.set(b.imported, b.local)
  }

  if (needsBaseTest) {
    const s = slot('@playwright/test')
    s.named.set('test', 'base')
    s.named.set('expect', 'expect')
  }

  const lines = []
  for (const [source, s] of bySource) {
    if (s.bare && !s.namespaces.size && !s.named.size) {
      lines.push(`import '${source}'`)
      continue
    }
    for (const ns of s.namespaces) lines.push(`import * as ${ns} from '${source}'`)
    const defaultLocal = s.named.get('default')
    const clause = [...s.named.entries()]
      .filter(([imported]) => imported !== 'default')
      .map(([imported, local]) => (imported === local ? imported : `${imported} as ${local}`))
    if (defaultLocal && clause.length) {
      lines.push(`import ${defaultLocal}, { ${clause.join(', ')} } from '${source}'`)
    } else if (defaultLocal) {
      lines.push(`import ${defaultLocal} from '${source}'`)
    } else if (clause.length) {
      lines.push(`import { ${clause.join(', ')} } from '${source}'`)
    }
    // A name already bound as a value needs no separate type import.
    const typeClause = [...s.typeNamed.entries()]
      .filter(([imported]) => !s.named.has(imported))
      .map(([imported, local]) => (imported === local ? imported : `${imported} as ${local}`))
    if (typeClause.length) lines.push(`import type { ${typeClause.join(', ')} } from '${source}'`)
  }
  return lines
}

// ---- the transformation --------------------------------------------------

/**
 * Pure core: given the spec text and a module loader, produce the inlined
 * spec. No filesystem access, so the whole matrix is unit-testable.
 *
 * @param {object} opts
 * @param {string} opts.specText composed spec source
 * @param {(name: string) => string|null} opts.loadModule snippet source by name
 * @param {string} [opts.sourceLabel] what to name as the source in the header
 * @param {string} [opts.date] ISO date for the header
 */
export function exportSpec({ specText, loadModule, sourceLabel = 'a composed spec', date }) {
  const warnings = []
  const specImports = []
  const specExternals = []

  for (const imp of scanImports(specText)) {
    const ref = snippetRefName(imp.source)
    if (ref) specImports.push({ ...imp, module: ref })
    else specExternals.push(imp)
  }

  if (specImports.length === 0) {
    fail("no snippet imports found (nothing matching `from '../snippets/<name>'`) — already inlined?", 6)
  }

  const modules = buildClosure(specImports, loadModule)
  const order = topoSort(modules)

  // Resolve each module's dep targets so binding emission can filter types.
  for (const mod of modules.values()) {
    mod.depModules = new Map()
    for (const dep of mod.deps) {
      if (modules.has(dep.module)) mod.depModules.set(dep.module, modules.get(dep.module))
    }
  }

  const fixtureModules = order.filter((n) => modules.get(n).isFixtureModule)
  const runtimeOrder = order.filter((n) => !modules.get(n).isFixtureModule)
  const consts = assignModuleConsts(runtimeOrder)

  // A fixture module in the closure means the spec takes `test` from it, so
  // the export needs Playwright's `test` aliased to `base` to rebuild from.
  const needsBaseTest = fixtureModules.length > 0

  const externals = specExternals.filter(
    (i) => !(needsBaseTest && i.source === '@playwright/test')
  )
  for (const name of runtimeOrder) externals.push(...modules.get(name).externals)

  // Only inlined modules contribute ambient shims — a stubbed fixture module's
  // `declare`s describe globals its (discarded) body needed.
  const lifted = []
  for (const name of runtimeOrder) {
    for (const decl of modules.get(name).declares) if (!lifted.includes(decl)) lifted.push(decl)
  }
  for (const decl of liftSharedTypes(modules, specImports, runtimeOrder)) {
    if (!lifted.includes(decl)) lifted.push(decl)
  }

  // ---- rewrite the spec's import lines ------------------------------------
  // Snippet imports become bindings against the module consts. External ones
  // are dropped here because they're re-emitted in the merged import block at
  // the top of the file — leaving them in place would duplicate them.

  let body = specText
  const specLines = [...specImports, ...specExternals].sort((a, b) => b.start - a.start)
  for (const imp of specLines) {
    const mod = imp.module ? modules.get(imp.module) : null
    // A fixture module's line simply goes away: `test`/`expect` now come from
    // the top-level import block and the stub.
    const replacement =
      !mod || mod.isFixtureModule
        ? ''
        : bindingStatements(imp.clause, consts.get(imp.module), mod).join('\n')
    const dropNewline = replacement === '' && specText[imp.end] === '\n' ? 1 : 0
    body = body.slice(0, imp.start) + replacement + body.slice(imp.end + dropNewline)
  }

  // ---- assemble ----------------------------------------------------------

  const stamp = date ?? new Date().toISOString().split('T')[0]
  const transitive = runtimeOrder.filter(
    (m) => !specImports.some((i) => i.module === m)
  )

  const out = [
    `// Exported from ${sourceLabel} on ${stamp} by forge's export-spec.`,
    `// Self-contained snapshot: the ${runtimeOrder.length} snippet module(s) below were inlined`,
    `// verbatim from forge/snippets/ and will NOT track later changes there.`,
    `// Re-run \`/forge export\` to refresh.`,
    `//`,
    `// Inlined: ${runtimeOrder.join(', ')}.`,
  ]
  if (transitive.length) out.push(`// Pulled in transitively: ${transitive.join(', ')}.`)
  if (fixtureModules.length) {
    out.push(`// Replaced by an env-var stub: ${fixtureModules.join(', ')} — see the stub comment.`)
  }
  out.push('')

  const importLines = mergeExternalImports(externals, needsBaseTest)
  if (importLines.length) out.push(importLines.join('\n'), '')
  if (lifted.length) out.push(lifted.join('\n'), '')

  // Only one module can supply the spec's `test`, and each stub declares it, so
  // a second would be a redeclaration.
  for (const name of fixtureModules.slice(1)) {
    warnings.push(
      `more than one fixture module is in the closure; "${name}" was ignored in favour of ` +
        `"${fixtureModules[0]}". Import \`test\` from a single fixture module.`
    )
  }
  if (fixtureModules.length) out.push(emitFixtureStub(modules.get(fixtureModules[0]), warnings), '')
  for (const name of runtimeOrder) out.push(emitModule(modules.get(name), consts.get(name), consts), '')

  out.push(body.replace(/^\n+/, ''))

  const text = out.join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/\s+$/, '') + '\n'

  return {
    text,
    modules: runtimeOrder,
    transitive,
    directImports: [...new Set(specImports.map((i) => i.module))],
    fixtureModules,
    warnings,
  }
}

// ---- CLI -----------------------------------------------------------------

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    console.log(USAGE)
    process.exit(0)
  }

  let specPath = null
  let outputPath = null
  let force = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--spec') {
      if (i + 1 >= argv.length) die('--spec requires a path', 2)
      specPath = argv[++i]
    } else if (arg === '--output') {
      if (i + 1 >= argv.length) die('--output requires a path', 2)
      outputPath = argv[++i]
    } else if (arg === '--force' || arg === '-f') {
      force = true
    } else {
      die(`unknown arg: ${arg}`, 2)
    }
  }

  if (!specPath) die('missing --spec <path>', 2)
  if (!outputPath) die('missing --output <path>', 2)

  specPath = resolve(specPath)
  outputPath = resolve(outputPath)

  if (!existsSync(specPath)) die(`spec not found: ${specPath}`, 4)
  if (existsSync(outputPath) && !force) {
    die(`output exists: ${outputPath} — use --force to overwrite`, 5)
  }

  const snippetsDir = resolve(dirname(specPath), '..', 'snippets')
  const loadModule = (name) => {
    const p = resolve(snippetsDir, `${name}.ts`)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  let result
  try {
    result = exportSpec({
      specText: readFileSync(specPath, 'utf8'),
      loadModule,
      // A relative path only helps while the output sits near the spec; once it
      // climbs out of the project it's noise, so fall back to the bare name.
      sourceLabel: (() => {
        const rel = relative(dirname(outputPath), specPath)
        return !rel || rel.startsWith('../../') ? basename(specPath) : rel
      })(),
    })
  } catch (err) {
    if (err instanceof ExportError) die(err.message, err.code)
    throw err
  }

  writeFileSync(outputPath, result.text)

  console.log(`forge-export-spec: exported ${specPath} → ${outputPath}`)
  console.log(
    `  Inlined ${result.modules.length} module(s): ` +
      `${result.directImports.length} imported directly by the spec, ` +
      `${result.transitive.length} pulled in transitively.`
  )
  console.log(`  Modules: ${result.modules.join(', ')}`)
  for (const w of result.warnings) console.log(`  WARNING: ${w}`)
  process.exit(0)
}

function die(msg, code) {
  console.error('forge-export-spec:', msg)
  process.exit(code)
}
