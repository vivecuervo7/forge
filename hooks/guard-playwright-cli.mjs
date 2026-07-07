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
// This hook denies a Bash command only when it actually INVOKES the binary
// — the token in command position of some simple command in the pipeline,
// possibly behind a launcher prefix (`npx`, `direnv exec`, `env`, `time`,
// `xargs`, …). Merely MENTIONING the token (a grep pattern, a commit
// message, a doc edit, a heredoc body) passes. Detection: strip heredoc
// bodies and quoted strings, split on shell separators, unwrap known
// launcher prefixes, then test the first word of each fragment.
//
// This is steering for a well-intentioned agent, not a security boundary
// (the redaction itself is best-effort transcript hygiene). A deliberately
// evasive invocation — e.g. `bash -c 'playwright-cli …'`, where the quoted
// payload is stripped before inspection — slips through by design; the
// threat model is an agent drifting into the naive shapes, which this
// catches. The should-deny / should-allow matrix lives in
// guard-playwright-cli.test.mjs alongside this file.
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

// Drop heredoc bodies (and their terminator lines): a commit message or
// script written via `cat <<'EOF' …` mentions tokens without running them.
// Introducer lines are kept; bodies are consumed until the delimiter line.
export function stripHeredocBodies(text) {
  const lines = text.split('\n')
  const out = []
  const pending = [] // heredocs open in source order: { delim, stripTabs }
  for (const line of lines) {
    if (pending.length > 0) {
      const { delim, stripTabs } = pending[0]
      const probe = stripTabs ? line.replace(/^\t+/, '') : line
      if (probe === delim) pending.shift()
      continue
    }
    out.push(line)
    const re = /<<(-?)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g
    let m
    while ((m = re.exec(line))) {
      pending.push({ delim: m[2] ?? m[3] ?? m[4], stripTabs: m[1] === '-' })
    }
  }
  return out.join('\n')
}

// Remove quoted spans (and backslash-escaped characters) so string
// arguments — grep patterns, -m messages — can't look like invocations.
// Each removed span becomes a single space to keep tokens separated.
export function stripQuotes(text) {
  let out = ''
  let state = null // null | "'" | '"'
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (state === "'") {
      if (ch === "'") {
        state = null
        out += ' '
      }
      continue
    }
    if (state === '"') {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === '"') {
        state = null
        out += ' '
      }
      continue
    }
    if (ch === '\\') {
      i++
      out += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      state = ch
      continue
    }
    out += ch
  }
  return out
}

// Launcher prefixes that hand off to the next word as the real command.
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'time', 'nohup', 'nice', 'sudo', 'xargs'])
// Flags of npx that consume a value — `npx -p pkg playwright-cli` still invokes.
const NPX_VALUE_FLAGS = new Set(['-p', '--package', '-c', '--call'])

function isPwToken(t) {
  return t === 'playwright-cli' || t.endsWith('/playwright-cli')
}

// Does one simple-command fragment invoke the binary (possibly behind
// env assignments and launcher prefixes)?
function fragmentInvokes(fragment) {
  let tokens = fragment.trim().split(/\s+/).filter(Boolean)
  for (;;) {
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift()
    if (tokens.length === 0) return false
    const t = tokens[0]
    if (isPwToken(t)) return true
    if (t === 'npx') {
      tokens.shift()
      while (tokens.length && tokens[0].startsWith('-')) {
        const flag = tokens.shift()
        if (NPX_VALUE_FLAGS.has(flag)) tokens.shift()
      }
      continue
    }
    if (t === 'env') {
      tokens.shift()
      while (tokens.length && (tokens[0].startsWith('-') || tokens[0].includes('='))) tokens.shift()
      continue
    }
    if (t === 'direnv' && tokens[1] === 'exec') {
      tokens = tokens.slice(3) // direnv exec <dir> <command…>
      continue
    }
    if (WRAPPERS.has(t)) {
      tokens.shift()
      while (tokens.length && tokens[0].startsWith('-')) tokens.shift()
      continue
    }
    return false
  }
}

// The full detection: true only when some simple command in the (quote- and
// heredoc-stripped) input runs the binary in command position.
export function invokesPlaywrightCli(command) {
  if (!command.includes('playwright-cli')) return false // cheap pre-filter
  const visible = stripQuotes(stripHeredocBodies(command))
  // With quotes gone, these separators are all genuine command boundaries.
  const fragments = visible.split(/[\n;&|(){}`]/)
  return fragments.some(fragmentInvokes)
}

async function main() {
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

  if (!invokesPlaywrightCli(command)) process.exit(0)

  const reason =
    'Route browser interactions through forge-pw, not the playwright-cli binary directly. ' +
    'Use `node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-cli.mjs pw -s=<SESSION_NAME> <command>` ' +
    '(add `--headed` on `open`). forge-pw forwards the command to playwright-cli unchanged ' +
    'while redacting env-sourced values from the echo — calling the binary directly leaks ' +
    'argv-borne secrets into the transcript and runs headless. If a project env recipe is ' +
    'needed, wrap forge-pw with it (`<recipe> node …/forge-cli.mjs pw …`). ' +
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
}

// Run only as the hook entry point — importable for tests without side effects.
import { fileURLToPath } from 'node:url'
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
