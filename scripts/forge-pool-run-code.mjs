#!/usr/bin/env node
// forge-pool-run-code.mjs — playwright-cli run-code with --env injection.
//
// Parameterized by playwright-cli session name. Designed for the team
// architecture where slot-bound chromium sessions are managed by the /forge
// skill.
//
// Why this exists: playwright-cli's run-code sandbox does NOT expose Node's
// `process` object. Naive `process.env.X` references in user code resolve to
// undefined. The fix is to wrap the user's code with a shimmed `process`
// that carries exactly the env vars the caller explicitly requested via
// --env flags. Values resolve from (in order, last wins): the slot's
// <slot>/.env file (when --slot is given), then this process's env (which
// already includes anything the user's shell direnv loaded).
//
// Hygiene: the literal values appear only in the wrapped code that's passed
// to playwright-cli. This script does NOT print the wrapped form to stdout
// or stderr — only the original (with `process.env.X` refs intact) would
// surface if anything were to log it. Calling agents see only the wrapper
// invocation with --env KEY flags in their tool-call transcripts; never
// the resolved values.
//
// Usage:
//   forge-pool-run-code.mjs -s=<session> <code> [--env KEY]... [--slot <dir>]
//   forge-pool-run-code.mjs --session <session> <code> [--env KEY]... [--slot <dir>]
//
// Each --env KEY must be resolvable from (--slot's .env merged with process.env).
// If a key isn't found in either source, the script fails with exit 3.
//
// Forge no longer requires direnv. Slot env values come from <slot>/.env
// (plain dotenv format); the user's shell direnv (if any) layers on top via
// process.env and takes precedence.
//
// Exit codes:
//   0   success — playwright-cli output is forwarded verbatim to stdout
//   2   usage / arg error
//   3   --env KEY not resolvable from slot .env or process env
//   4   playwright-cli not installed
//   any other — playwright-cli's exit code is propagated

import { spawnSync } from 'node:child_process'
import { loadSlotEnv } from './forge-slot-env.mjs'

function die(msg, code = 2) {
  console.error('forge-pool-run-code:', msg)
  process.exit(code)
}

const argv = process.argv.slice(2)

let session = null
let code = null
let slot = null
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
  } else if (arg === '--slot') {
    if (i + 1 >= argv.length) die('--slot requires a path')
    slot = argv[++i]
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

// Resolve env from slot .env (if --slot given) merged with process.env
// (which already contains anything the user's shell direnv loaded). process.env
// wins, so user direnv overrides slot.
const slotEnv = loadSlotEnv(slot)
const combinedEnv = { ...slotEnv, ...process.env }

const envObj = {}
for (const key of envKeys) {
  if (combinedEnv[key] === undefined) {
    die(
      `--env ${key}: not resolvable from slot .env (${slot || '<no --slot>'}) ` +
      `or process env. Add it to <slot>/.env, your project root .env (loaded ` +
      `via playwright config), or your shell environment.`,
      3
    )
  }
  envObj[key] = combinedEnv[key]
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

// Forward playwright-cli's output verbatim — its stdout, stderr, and exit code.
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
