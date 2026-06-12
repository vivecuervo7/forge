#!/usr/bin/env node
// forge-pool-invoke-snippet.mjs — invoke a forge snippet against a slot's chromium.
//
// Counterpart to forge-pool-run-code.mjs but for prebuilt snippets. The snippet is
// a .ts file exporting `meta` (description, args, envKeys, preconditions) and a
// `run(page, args)` function. This script:
//
//   1. Dynamically imports the snippet (Node 24 strips TS types natively).
//   2. Reads `meta.envKeys`; if any are declared, resolves them from this
//      process's env (where direnv exec <slot> loaded them) and builds a
//      process shim — same mechanism as forge-pool-run-code.mjs.
//   3. Composes the wrapped run-code body:
//        async page => {
//          const process = { env: {...} };  // only when envKeys declared
//          const args = <args-json>;
//          const __wrRun = <run.toString()>;
//          return await __wrRun(page, args);
//        }
//   4. Calls `playwright-cli -s=<session> run-code <wrapped>`.
//   5. Forwards stdout/stderr/exit-code verbatim.
//
// The original snippet body (with `process.env.X` references intact) lives only
// in the snippet file. Resolved env values appear in the wrapped code passed to
// playwright-cli, never in this script's stdout.
//
// Usage:
//   forge-pool-invoke-snippet.mjs -s=<session> --snippet <path> [--args '<json>']
//
// Exit codes:
//   0   success — playwright-cli output forwarded verbatim
//   2   usage / arg error / invalid JSON / snippet missing run()
//   3   --env declared on snippet but value missing in process env
//   4   playwright-cli not installed
//   5   spawn error
//   any other — playwright-cli's exit code is propagated

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

function die(msg, code = 2) {
  console.error('forge-pool-invoke-snippet:', msg)
  process.exit(code)
}

const argv = process.argv.slice(2)

let session = null
let snippetPath = null
let argsJson = '{}'

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

// Dynamic import. Cache-bust with timestamp to allow snippets to be edited
// and re-invoked in the same Node process if a long-lived caller ever exists.
let mod
try {
  mod = await import(pathToFileURL(snippetPath).href + `?t=${Date.now()}`)
} catch (e) {
  die(`failed to import snippet ${snippetPath}: ${e.message || e}`)
}

const meta = mod.meta || {}
if (typeof mod.run !== 'function') {
  die(`snippet at ${snippetPath} does not export a run(page, args) function`)
}

// Resolve declared envKeys from this process's env. The caller (driver agent)
// must have wrapped this invocation with the project's env loader (typically
// `direnv exec <slot-dir>`) so the keys are present.
let processShim = ''
if (Array.isArray(meta.envKeys) && meta.envKeys.length > 0) {
  const envObj = {}
  for (const key of meta.envKeys) {
    if (process.env[key] === undefined) {
      die(
        `snippet declares envKeys including "${key}" but it's not set in this process. ` +
        `Wrap the invocation with the project's env loader (e.g. \`direnv exec <slot-dir> ...\`).`,
        3
      )
    }
    envObj[key] = process.env[key]
  }
  processShim = `const process = { env: ${JSON.stringify(envObj)} };\n`
}

const runSrc = mod.run.toString()

// Compose the wrapped run-code body. The whole run function is embedded as a
// callable expression (`const __wrRun = <runSrc>; return await __wrRun(page, args)`)
// rather than extracting its body — sidesteps brace-matching ambiguity around
// destructured parameters with defaults.
const wrappedCode = `async page => {
${processShim}const args = ${JSON.stringify(parsedArgs)};
const __wrRun = ${runSrc};
return await __wrRun(page, args);
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
