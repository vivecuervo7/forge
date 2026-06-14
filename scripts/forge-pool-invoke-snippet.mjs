#!/usr/bin/env node
// forge-pool-invoke-snippet.mjs — invoke a forge snippet against a slot's chromium.
//
// Counterpart to forge-pool-run-code.mjs but for prebuilt snippets. The snippet is
// a .ts file exporting `meta` (description, args, envKeys, preconditions) and a
// `run(page, args)` function. The snippet may also have module-internal helpers,
// constants, and relative imports of other snippets.
//
// What this script does:
//
//   1. Reads `meta.envKeys` directly from the snippet's raw source via regex.
//      It does NOT dynamically import the snippet — Node 24's strict ESM
//      resolver rejects extensionless relative imports against .ts files,
//      which breaks the moment a snippet composes another snippet.
//   2. Resolves declared envKeys from the slot's .env (when --slot is given)
//      merged with this process's env. process.env wins, so user shell
//      direnv layers on top of slot values cleanly. envKeys is treated as
//      informational: missing keys are skipped, not fatal — the snippet
//      body decides what's actually required (via throws or fallbacks).
//   3. Bundles the snippet with esbuild — `--bundle --platform=node
//      --format=esm --external:playwright --external:@playwright/test`.
//      Bundling is load-bearing: it transpiles TS types away, inlines
//      cross-snippet relative imports, and produces a single self-contained
//      JS blob ready to cross the playwright-cli sandbox boundary.
//   4. Strips `export` keywords from the bundle output so all names live in
//      local scope inside the wrapped `async page => { ... }` function.
//   5. Injects a `const process = { env: {...} }` shim containing only the
//      declared envKeys, so `process.env.X` references inside the bundle
//      resolve in the browser-side sandbox (which doesn't expose Node's
//      process object).
//   6. Wraps the bundle as `async page => { <shim>; <bundle>; const __args
//      = <args-json>; return await run(page, __args); }` and passes the
//      whole thing to `playwright-cli -s=<session> run-code`.
//   7. Forwards stdout/stderr/exit-code verbatim.
//
// Why the bundler approach: an earlier version tried `mod.run.toString()`
// over a dynamically-imported snippet. That broke in five distinct ways:
// only the run() body crossed the sandbox boundary (named exports lost);
// module-internal helpers were lost; types couldn't be evaluated; cross-
// snippet imports couldn't be resolved on Node 24; dynamic import is
// blocked inside the run-code VM sandbox itself. esbuild + bundling
// solves all five at once.
//
// Esbuild ships with the plugin runner. First invocation may trigger a
// ~30s install at ~/.claude/.vive-claude/forge/runner/; subsequent calls
// (across forge projects on the machine) are free.
//
// Usage:
//   forge-pool-invoke-snippet.mjs -s=<session> --snippet <path> [--args '<json>'] [--slot <dir>]
//
// Exit codes:
//   0   success — playwright-cli output forwarded verbatim
//   2   usage / arg error / invalid JSON / snippet missing run / bundler failure
//   4   playwright-cli not installed
//   5   spawn error
//   any other — playwright-cli's exit code is propagated

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { loadSlotEnv } from './forge-slot-env.mjs'
import { ensureBundlerAvailable, PLUGIN_ESBUILD_BIN } from './forge-ensure-runner.mjs'

function die(msg, code = 2) {
  console.error('forge-pool-invoke-snippet:', msg)
  process.exit(code)
}

const argv = process.argv.slice(2)

let session = null
let snippetPath = null
let argsJson = '{}'
let slot = null

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg.startsWith('-s=')) {
    session = arg.slice(3)
  } else if (arg === '-s' || arg === '--session') {
    if (i + 1 >= argv.length) die('--session requires a value')
    session = argv[++i]
  } else if (arg === '--snippet') {
    if (i + 1 >= argv.length) die('--snippet requires a path')
    snippetPath = argv[++i]
  } else if (arg === '--args') {
    if (i + 1 >= argv.length) die('--args requires JSON')
    argsJson = argv[++i]
  } else if (arg === '--slot') {
    if (i + 1 >= argv.length) die('--slot requires a path')
    slot = argv[++i]
  } else {
    die(`unknown arg: ${arg}`)
  }
}

if (!session) die('missing -s=<session-name>')
if (!snippetPath) die('missing --snippet <path>')

let parsedArgs
try {
  parsedArgs = JSON.parse(argsJson)
} catch (e) {
  die(`invalid --args JSON: ${e.message}`)
}

// Read raw source. NEVER dynamically import — Node 24's strict ESM rejects
// extensionless imports against .ts files, which is how snippets compose
// each other (e.g. `import { searchEvent } from './search-event'`).
let rawSrc
try {
  rawSrc = readFileSync(snippetPath, 'utf8')
} catch (e) {
  die(`failed to read snippet ${snippetPath}: ${e.message || e}`)
}

// Parse envKeys from raw source. Matches `envKeys: ['KEY1', 'KEY2']` or
// `envKeys: ["KEY1", "KEY2"]` — the standard meta-block shape. The regex
// is intentionally conservative: keys must be SCREAMING_SNAKE_CASE.
const envKeysMatch = rawSrc.match(/envKeys\s*:\s*\[([^\]]*)\]/)
let envKeys = []
if (envKeysMatch) {
  envKeys = [...envKeysMatch[1].matchAll(/['"]([A-Z_][A-Z0-9_]*)['"]/g)].map(m => m[1])
}

// Verify the snippet exports a run() function via raw-source check. Catches
// the common "forgot to export run" mistake without dynamic import.
if (!/export\s+(?:async\s+)?function\s+run\s*\(/.test(rawSrc) &&
    !/export\s*\{[^}]*\brun\b[^}]*\}/.test(rawSrc)) {
  die(`snippet at ${snippetPath} does not export a run(page, args) function`)
}

// Resolve declared envKeys. Slot .env first, process.env overrides — same
// semantics as forge-pool-run-code.mjs so direnv shell layers win.
//
// envKeys is informational, not enforcing: it tells us which env vars to
// include in the `process = { env: ... }` shim so the snippet's
// `process.env.X` references resolve inside the playwright-cli sandbox.
// We pass through whatever IS set among the declared keys and skip
// quietly for the rest — the snippet body is authoritative about what's
// actually required (via `if (!X) throw` for hard reqs; `?? 'default'`
// for soft ones). Hard-failing here would contradict snippet bodies that
// have legitimate fallbacks (e.g. a base URL that defaults to localhost
// when no FORGE_BASE_URL is set).
const slotEnv = loadSlotEnv(slot)
const combinedEnv = { ...slotEnv, ...process.env }

const envObj = {}
for (const key of envKeys) {
  if (combinedEnv[key] !== undefined) {
    envObj[key] = combinedEnv[key]
  }
}

// Ensure esbuild is installed. First call pays ~30s; subsequent calls are free.
try {
  ensureBundlerAvailable()
} catch (e) {
  die(`bundler unavailable: ${e.message || e}`, 2)
}

// Bundle the snippet. esbuild handles:
//   - TS type stripping (--platform=node)
//   - Cross-snippet relative imports inlined (--bundle)
//   - Playwright stays external (won't try to resolve @playwright/test for
//     snippets that import it for types — though most snippets don't)
const transpile = spawnSync(PLUGIN_ESBUILD_BIN, [
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
// these would be syntax errors. Three patterns to catch:
//   1. re-export blocks:   export { foo, bar };
//   2. default exports:    export default <expr>
//   3. named exports:      export const X = ..., export function Y(...), etc.
const jsBody = transpile.stdout
  .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/^export\s+default\s+/gm, '')
  .replace(/^export\s+(?=(?:async\s+)?function|const|let|var|class)/gm, '')

// Compose the wrapped run-code body. The shim ONLY includes declared envKeys
// — don't leak the broader environment into the sandbox.
const processShim = Object.keys(envObj).length > 0
  ? `const process = { env: ${JSON.stringify(envObj)} };\n`
  : ''

const wrappedCode = `async page => {
${processShim}${jsBody}
const __args = ${JSON.stringify(parsedArgs)};
return await run(page, __args);
}`

const result = spawnSync(
  'playwright-cli',
  [`-s=${session}`, 'run-code', wrappedCode],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
)

if (result.error) {
  if (result.error.code === 'ENOENT') {
    die('playwright-cli not installed or not on PATH', 4)
  }
  die(`spawn error: ${result.error.message}`, 5)
}

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
