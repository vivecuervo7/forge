#!/usr/bin/env node
// forge-invoke-snippet.mjs — invoke a forge snippet against a playwright-cli session.
//
// The snippet is a .ts file exporting a `run(page, args)` function and an
// optional `meta` block (description, args, tags). Snippets are pure
// functional units: they take their config (including any env-sourced
// values) as args and don't read process.env. The CALLER decides what to
// pass.
//
// This script does NO env handling. Args are passed through verbatim. The
// caller (driver agent, or any other invoker) is responsible for sourcing
// env values — typically via native shell expansion at the Bash boundary,
// e.g. `--args "{\"username\":\"$ADMIN_USERNAME\"}"`. The shell expands the
// reference before forge ever sees it; the tool-call transcript records the
// unexpanded `$VAR` string; the literal value reaches forge only through
// argv, never through any logged channel. See the driver agent prompt's
// "Environment variables" section for the full rule.
//
// What this script does:
//
//   1. Bundles the snippet with esbuild: `--bundle --platform=node
//      --format=esm --external:playwright --external:@playwright/test`.
//      Bundling is load-bearing — it transpiles TS types away, inlines
//      cross-snippet relative imports, and produces a single self-contained
//      JS blob ready to cross the sandbox boundary.
//   2. Strips `export` keywords from the bundle output so all names live in
//      local scope inside the wrapped `async page => { ... }` function.
//   3. Wraps the bundle as `async page => { <bundle>; const __args =
//      <args-json>; return await run(page, __args); }` and passes the whole
//      thing to `playwright-cli -s=<session> run-code`.
//   4. Forwards stdout/stderr/exit-code verbatim.
//
// Why the bundler approach: snippets need full module semantics inside the
// playwright-cli run-code sandbox — named exports, internal helpers, TS
// type stripping, cross-snippet imports — and the sandbox itself blocks
// dynamic import. esbuild bundles everything into a single self-contained
// JS blob that crosses the boundary cleanly and runs as plain code, which
// is the only shape the sandbox supports.
//
// Usage:
//   forge-invoke-snippet.mjs -s=<session> --snippet <path> [--args '<json>'] [--json]
//
// --json (or FORGE_JSON=1) opts into playwright-cli's structured JSON
// output mode. Without it, you get the verbose "### Ran Playwright code"
// echo that wraps the snippet body. With it, stdout is
// `{result: "<return-value-as-string>"}` on success, or
// `{isError: true, error: "<message>"}` on failure. The snippet's return
// value (e.g. `return await page.locator(...).count()`) surfaces as
// `result`. Recommended for agent-driven invocations.
//
// Exit codes:
//   0   success — playwright-cli output forwarded verbatim
//   2   usage / arg error / invalid JSON / snippet missing run / bundler failure
//   4   playwright-cli not installed
//   5   spawn error
//   any other — playwright-cli's exit code is propagated

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRunnerDeps, esbuildBinFor, loadFromRunner } from './forge-ensure-runner.mjs'
import { looksLikeForgeRoot } from './forge-common.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FORGE_PW = join(__dirname, 'forge-pw.mjs')

function die(msg, code = 2) {
  console.error('forge-invoke-snippet:', msg)
  process.exit(code)
}

// Bootstrap mri load — we need the snippet path to derive forgeRoot before
// runner deps are available. Read it from raw argv first.
function rawArgValue(name, short = null) {
  const av = process.argv.slice(2)
  for (let i = 0; i < av.length; i++) {
    if (av[i] === name && i + 1 < av.length) return av[i + 1]
    if (short && av[i] === short && i + 1 < av.length) return av[i + 1]
    if (av[i].startsWith(`${name}=`)) return av[i].slice(name.length + 1)
    if (short && av[i].startsWith(`${short}=`)) return av[i].slice(short.length + 1)
  }
  return null
}

const rawSnippet = rawArgValue('--snippet')
if (!rawSnippet) die('missing --snippet <path>')

// Validate the derived forge root BEFORE ensureRunnerDeps — installing runner
// deps into a directory derived from an unvalidated path could overwrite an
// unrelated package.json (e.g. --snippet ~/foo.ts → homedir).
const forgeRoot = dirname(dirname(resolve(rawSnippet)))
if (!looksLikeForgeRoot(forgeRoot)) {
  die(
    `snippet at ${resolve(rawSnippet)} doesn't appear to live under a forge/ directory ` +
    `(expected ${forgeRoot}/hints/ to exist). Check the path.`
  )
}
ensureRunnerDeps(forgeRoot)

const { default: mri } = await loadFromRunner(forgeRoot, 'mri')
const args = mri(process.argv.slice(2), {
  string: ['session', 'snippet', 'args'],
  boolean: ['json'],
  alias: { s: 'session' },
  default: { args: '{}', json: false },
})

const session = args.session ?? null
const snippetPath = args.snippet
const argsJson = args.args
const jsonMode = args.json || process.env.FORGE_JSON === '1'

if (!session) die('missing -s=<session-name>')

let parsedArgs
try {
  parsedArgs = JSON.parse(argsJson)
} catch (e) {
  die(`invalid --args JSON: ${e.message}`)
}

// Read raw source. NEVER dynamically import — Node 24's strict ESM rejects
// extensionless imports against .ts files, which is how snippets compose
// each other (e.g. `import { addItem } from './add-item-to-cart'`).
let rawSrc
try {
  rawSrc = readFileSync(snippetPath, 'utf8')
} catch (e) {
  die(`failed to read snippet ${snippetPath}: ${e.message || e}`)
}

// Verify the snippet exports a run() function via raw-source check. Catches
// the common "forgot to export run" mistake without dynamic import.
if (!/export\s+(?:async\s+)?function\s+run\s*\(/.test(rawSrc) &&
    !/export\s*\{[^}]*\brun\b[^}]*\}/.test(rawSrc)) {
  die(`snippet at ${snippetPath} does not export a run(page, args) function`)
}

// Bundle the snippet. esbuild handles:
//   - TS type stripping (--platform=node)
//   - Cross-snippet relative imports inlined (--bundle)
//   - Playwright stays external (won't try to resolve @playwright/test for
//     snippets that import it for types — though most snippets don't)
const transpile = spawnSync(esbuildBinFor(forgeRoot), [
  snippetPath,
  '--platform=node',
  '--format=esm',
  '--bundle',
  '--external:playwright',
  '--external:@playwright/test',
], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })

if (transpile.status !== 0) {
  die(`esbuild failed bundling ${snippetPath}:\n${transpile.stderr || transpile.stdout || '<no output>'}`)
}

// Strip `export` keywords from the bundle. esbuild emits ESM with explicit
// exports; the playwright-cli run-code sandbox doesn't run as a module, so
// these would be syntax errors. Three patterns:
//   1. re-export blocks:   export { foo, bar };
//   2. default exports:    export default <expr>
//   3. named exports:      export const X = ..., export function Y(...), etc.
const jsBody = transpile.stdout
  .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/^export\s+default\s+/gm, '')
  .replace(/^export\s+(?=(?:async\s+)?function|const|let|var|class)/gm, '')

// Page-selection prelude: re-target `page` to the most recent tab that matches
// the snippet's declared precondition, falling back to the most recent
// non-blank tab. Without this, snippets often run against a stray about:blank
// the driver left behind during exploration — the 0.16/0.17 rewrite dropped
// the 0.9.7 prelude and triggered an "all snippets failed" regression that
// the prelude's reintroduction resolved.
// Safe by design: if nothing matches, we leave `page` alone (cold-start case
// where about:blank is the only tab).
const pageSelectPrelude = `try {
  const __metaPre = (typeof meta !== 'undefined' && meta) ? meta : {};
  const __preUrl = __metaPre.preconditions && __metaPre.preconditions.url;
  const __requires = typeof __metaPre.requires === 'string' ? __metaPre.requires : '';
  let __urlRe = null;
  if (__preUrl instanceof RegExp) __urlRe = __preUrl;
  else if (typeof __preUrl === 'string' && __preUrl.length) __urlRe = new RegExp(__preUrl);
  else {
    const __m = __requires.match(/\\/[A-Za-z0-9_\\-\\/]+/);
    if (__m) __urlRe = new RegExp(__m[0].replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'));
  }
  const __pages = page.context().pages();
  const __target = __urlRe
    ? __pages.findLast(p => __urlRe.test(p.url()))
    : __pages.findLast(p => !p.url().startsWith('about:'));
  if (__target && __target !== page) {
    await __target.bringToFront().catch(() => {});
    page = __target;
  }
} catch {}
`

const wrappedCode = `async page => {
${jsBody}
${pageSelectPrelude}
const __args = ${JSON.stringify(parsedArgs)};
return await run(page, __args);
}`

// Route the run-code invocation through forge-pw so any env-sourced values
// that ended up inlined in `wrappedCode` (via JSON.stringify of parsedArgs)
// get redacted from playwright-cli's "Ran Playwright code" echo before
// reaching the caller's tool-call transcript. In JSON mode, the echo is
// suppressed entirely and stdout is structured `{result|isError}`; redaction
// still runs as a defensive layer over the JSON.
const pwArgs = jsonMode
  ? ['--json', `-s=${session}`, 'run-code', wrappedCode]
  : [`-s=${session}`, 'run-code', wrappedCode]
const result = spawnSync(
  'node',
  [FORGE_PW, ...pwArgs],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
)

if (result.error) {
  if (result.error.code === 'ENOENT') {
    die('node not on PATH (required to invoke forge-pw)', 4)
  }
  die(`spawn error: ${result.error.message}`, 5)
}

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
