#!/usr/bin/env node
// forge-pw.mjs — wrapper around playwright-cli with env-value redaction
// and optional structured JSON pass-through.
//
// Why this exists: playwright-cli's subcommands (fill, click, run-code,
// etc.) echo the JavaScript code they ran in their output — a "### Ran
// Playwright code" block containing the equivalent JS, including any
// values passed in argv. When values reach playwright-cli via shell
// expansion (`fill ... "$ADMIN_USERNAME"`), the resolved value lands in
// the output, which lands in the tool-call transcript. That defeats the
// shell-expansion approach's transcript hygiene.
//
// What this wrapper does:
//
//   1. Reads process.env once at startup. Builds a map from any value
//      >= MIN_LENGTH chars to a `$KEY` placeholder. (Below threshold
//      values are too noise-prone to redact safely — `USER=alice` would
//      mangle any output mentioning the user's name.)
//   2. Spawns playwright-cli with the args it received (with `--json`
//      injected when `--json` or `FORGE_JSON=1` was requested), piping
//      stdout and stderr.
//   3. Buffers each stream by line, replaces matching values with their
//      placeholders, forwards redacted lines to its own stdout/stderr.
//   4. Exits with playwright-cli's exit code.
//
// JSON mode:
//
//   Pass `--json` as the first arg to forge-pw, or set FORGE_JSON=1 in
//   the env. The wrapper strips the flag from forge-pw's own argv and
//   injects `--json` into playwright-cli's argv right after the session
//   flag (so it applies globally as a playwright-cli flag, not as a
//   subcommand arg). playwright-cli's `--json` mode suppresses the
//   verbose "### Ran Playwright code" echo and emits structured JSON
//   instead — shapes like `{result: "..."}` for run-code, `{snapshot:
//   {file: ...}}` for navigations, or `{isError: true, error: "..."}`
//   on failure. Env-redaction still runs over the JSON output as a
//   defensive layer in case any env value ended up inside a `result`
//   field.
//
//   Without `--json`, the wrapper behaves exactly as before — text
//   pass-through with the "Ran Playwright code" echo intact and env
//   values redacted line-by-line.
//
// What the wrapper does NOT do:
//
//   - Persist values anywhere. Read at startup, used in-memory only.
//   - Log values. Errors reference key names where applicable.
//   - Expose values to the calling process beyond the redaction map.
//
// What the wrapper's caveats are:
//
//   - String-matching only. Encoded / transformed values (URL-encoded,
//     base64-wrapped, JSON-stringified with escapes) won't match and
//     leak through.
//   - Over-redaction is possible. Any process.env value >= MIN_LENGTH
//     chars appearing in output gets replaced — including paths,
//     terminal types, etc. The replacement names the source key
//     (`$PATH`, `$TERM`) so the affected output stays interpretable.
//   - This is best-effort transcript hygiene, not a security boundary.
//
// Usage:
//   forge-pw.mjs [--json] <playwright-cli args...>
//
// Exit codes:
//   propagated from playwright-cli, except:
//   4   playwright-cli not installed or not on PATH
//   5   spawn error

import { spawn } from 'node:child_process'

const MIN_LENGTH = 8

function buildRedactMap() {
  const map = new Map()
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue
    if (value.length < MIN_LENGTH) continue
    if (!map.has(value)) {
      map.set(value, `$${key}`)
    }
  }
  return map
}

function redact(text, map) {
  let result = text
  for (const [value, placeholder] of map) {
    if (result.includes(value)) {
      result = result.split(value).join(placeholder)
    }
  }
  return result
}

// Parse forge-pw's own --json flag out of argv before forwarding to
// playwright-cli. Also honor FORGE_JSON=1 in env.
const rawArgs = process.argv.slice(2)
let jsonMode = process.env.FORGE_JSON === '1'
const filteredArgs = []
for (const a of rawArgs) {
  if (a === '--json') {
    jsonMode = true
    continue
  }
  filteredArgs.push(a)
}

// In JSON mode, inject --json into playwright-cli's argv. Global
// playwright-cli flags work in any position, so prepending is safe.
const childArgs = jsonMode ? ['--json', ...filteredArgs] : filteredArgs

const redactMap = buildRedactMap()

const child = spawn('playwright-cli', childArgs, {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
})

let stdoutBuf = ''
let stderrBuf = ''

child.stdout.on('data', chunk => {
  stdoutBuf += chunk.toString()
  const lines = stdoutBuf.split('\n')
  stdoutBuf = lines.pop() ?? ''
  for (const line of lines) {
    process.stdout.write(redact(line, redactMap) + '\n')
  }
})

child.stderr.on('data', chunk => {
  stderrBuf += chunk.toString()
  const lines = stderrBuf.split('\n')
  stderrBuf = lines.pop() ?? ''
  for (const line of lines) {
    process.stderr.write(redact(line, redactMap) + '\n')
  }
})

child.on('close', code => {
  if (stdoutBuf) process.stdout.write(redact(stdoutBuf, redactMap))
  if (stderrBuf) process.stderr.write(redact(stderrBuf, redactMap))
  process.exit(code ?? 0)
})

child.on('error', err => {
  if (err.code === 'ENOENT') {
    console.error('forge-pw: playwright-cli not installed or not on PATH')
    process.exit(4)
  }
  console.error(`forge-pw: spawn error: ${err.message}`)
  process.exit(5)
})
