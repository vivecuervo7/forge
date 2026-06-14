#!/usr/bin/env node
// forge-run-code.mjs — playwright-cli run-code with --env injection.
//
// Parameterized by playwright-cli session name. Designed for the team
// architecture: the driver writes one-off inline code (snapshots, locator
// probes, ad-hoc page interactions) and forge handles env injection so
// `process.env.X` references resolve inside playwright-cli's sandbox.
//
// Why this exists: playwright-cli's run-code sandbox does NOT expose Node's
// `process` object. Naive `process.env.X` references in user code resolve to
// undefined. The fix is to wrap the user's code with a shimmed `process`
// that carries exactly the env vars the caller explicitly requested via
// --env flags.
//
// Hygiene: the literal values appear only in the wrapped code that's passed
// to playwright-cli. This script does NOT print the wrapped form to stdout
// or stderr — only the original (with `process.env.X` refs intact) would
// surface if anything were to log it. Calling agents see only the wrapper
// invocation with --env KEY flags in their tool-call transcripts; never
// the resolved values.
//
// Usage:
//   forge-run-code.mjs -s=<session> <code> [--env KEY]...
//   forge-run-code.mjs --session <session> <code> [--env KEY]...
//
// Each --env KEY must be present in process.env (which includes shell env
// + anything direnv loaded + anything the playwright config loaded via
// dotenv). If a key isn't found, the script fails with exit 3.
//
// Exit codes:
//   0   success — playwright-cli output is forwarded verbatim to stdout
//   2   usage / arg error
//   3   --env KEY not resolvable from process.env
//   4   playwright-cli not installed
//   any other — playwright-cli's exit code is propagated

import { spawnSync } from 'node:child_process'

function die(msg, code = 2) {
  console.error('forge-run-code:', msg)
  process.exit(code)
}

const argv = process.argv.slice(2)

let session = null
let code = null
const envKeys = []

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg.startsWith('-s=')) {
    session = arg.slice(3)
  } else if (arg === '--session' || arg === '-s') {
    if (i + 1 >= argv.length) die('--session requires a value')
    session = argv[++i]
  } else if (arg === '--env') {
    if (i + 1 >= argv.length) die('--env requires a KEY')
    envKeys.push(argv[++i])
  } else if (arg.startsWith('-')) {
    die(`unknown flag: ${arg}`)
  } else if (code === null) {
    code = arg
  } else {
    die(`unexpected positional arg: ${arg}`)
  }
}

if (!session) die('missing -s=<session-name>')
if (code === null) die('missing <code> positional arg')

const envObj = {}
for (const key of envKeys) {
  if (process.env[key] === undefined) {
    die(
      `--env ${key}: not resolvable from process.env. Set the env var (via ` +
      `direnv, shell export, or forge/.env loaded by playwright config) and retry.`,
      3
    )
  }
  envObj[key] = process.env[key]
}

// Wrap the user's code so `process.env.X` references resolve to the injected
// literals inside playwright-cli's sandbox. The shadowed `process` only
// carries `env`; everything else on real `process` remains unavailable in
// run-code (which is the intended sandbox behavior).
const wrappedCode = envKeys.length > 0
  ? `async page => { const process = { env: ${JSON.stringify(envObj)} }; return await (${code})(page); }`
  : code

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
