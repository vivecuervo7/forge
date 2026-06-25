#!/usr/bin/env node
// guard-playwright-cli.mjs — PreToolUse guard that keeps every browser
// interaction routed through forge-pw.
//
// Why this exists: forge's driver and diagnosis re-drive talk to the
// browser through `forge-pw.mjs`, a thin wrapper around the `playwright-cli`
// binary that redacts env-sourced values from playwright-cli's "### Ran
// Playwright code" echo before it lands in the tool-call transcript.
// Calling the `playwright-cli` binary directly — bare, or wrapped as
// `direnv exec … playwright-cli` / `npx playwright-cli` — bypasses that
// redaction and sends any argv-borne secret to the transcript in the clear.
// It also defaults to headless, so the user can't watch the drive.
//
// This hook denies any Bash command that invokes the `playwright-cli`
// binary directly and steers the caller to forge-pw. forge's own scripts
// (forge-pw.mjs, forge-invoke-snippet.mjs, forge-run-spec.mjs) never contain
// the literal token `playwright-cli`, so its presence as a command word
// reliably means the binary is being called directly.
//
// Escape hatch: set FORGE_ALLOW_RAW_PW=1 in the shell that launches Claude
// Code (so the hook process inherits it) to allow raw playwright-cli — e.g.
// for hand debugging outside a forge run. An agent can't set it inline on a
// single command, because the hook reads its own process env, not the
// command's inline assignments.
//
// Contract: reads the PreToolUse payload as JSON on stdin. Emits a deny
// decision as JSON on stdout when it blocks; otherwise stays silent and
// exits 0 (the tool call proceeds).

let raw = ''
try {
  raw = await new Promise((resolve) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (buf += c))
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', () => resolve(buf))
  })
} catch {
  process.exit(0) // can't read input — don't interfere
}

let payload
try {
  payload = JSON.parse(raw || '{}')
} catch {
  process.exit(0) // not JSON — don't interfere
}

// Only Bash commands carry shell invocations worth guarding.
const toolName = payload.tool_name ?? payload.toolName ?? ''
if (toolName !== 'Bash') process.exit(0)

const command = payload.tool_input?.command ?? payload.toolInput?.command ?? ''
if (typeof command !== 'string' || command.length === 0) process.exit(0)

// Explicit, user-set escape hatch.
if (process.env.FORGE_ALLOW_RAW_PW === '1') process.exit(0)

// The literal token never appears in forge's own scripts, so any occurrence
// as a word means the binary is being invoked directly.
const callsPlaywrightCliDirectly = /\bplaywright-cli\b/.test(command)
if (!callsPlaywrightCliDirectly) process.exit(0)

const reason =
  'Route browser interactions through forge-pw, not the playwright-cli binary directly. ' +
  'Use `node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pw.mjs -s=<SESSION_NAME> <command>` ' +
  '(add `--headed` on `open`). forge-pw forwards the command to playwright-cli unchanged ' +
  'while redacting env-sourced values from the echo — calling the binary directly leaks ' +
  'argv-borne secrets into the transcript and runs headless. If a project env recipe is ' +
  'needed, wrap forge-pw with it (`<recipe> node …/forge-pw.mjs …`). ' +
  '(Operator override: launch Claude Code with FORGE_ALLOW_RAW_PW=1 to permit raw playwright-cli.)'

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })
)
process.exit(0)
