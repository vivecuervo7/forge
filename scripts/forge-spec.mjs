#!/usr/bin/env node
// forge-spec.mjs — synthesise a Playwright .spec.ts from a session transcript slice.
//
// Subcommands:
//   events <session-id>
//     Read $FORGE_ROOT/sessions/<session-id>.jsonl and print a JSON array of
//     events with display-friendly fields (1-indexed, snippet, args, result, hadResult).
//     Used by the skill to present the slice to the user.
//
//   write ['<options-json>']
//     Build and write a .spec.ts to $FORGE_ROOT/specs/<label>.spec.ts.
//     Every option has a sensible default — calling `write '{}'` produces a
//     usable spec with no further input. Pass overrides only when the caller
//     wants to slice differently or supply custom assertions.
//
//     All options optional:
//       sessionId        defaults to $CLAUDE_CODE_SESSION_ID
//       startAt          default 1 (first event)
//       drop             list of 1-indexed event indices to skip; default []
//       label            default: derived from snippet names
//                        (single step → snippet name; multi → first-then-last)
//       assertions       array of raw expect(...) statement strings.
//                        If omitted, ONE terminal assertion is auto-proposed
//                        from the last step's result shape.
//       skipAssertion    bool; force no assertion (even on auto-propose)
//
// Each retained event becomes a sequential block in the test body. The snippet's
// run() function is embedded as a literal and called with the recorded args.
// Args are credential-redacted; references to process.env appear at the top.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.FORGE_ROOT || join(homedir(), '.claude/.vive-claude/forge')
const TIERS = ['library', 'staged', 'scratch', 'broken']

function die(msg, code = 1) {
  console.error('forge-spec:', msg)
  process.exit(code)
}

function loadTranscript(sessionId) {
  const path = join(ROOT, 'sessions', `${sessionId}.jsonl`)
  if (!existsSync(path)) die(`no transcript for session ${sessionId} (looked at ${path})`, 1)
  const raw = readFileSync(path, 'utf8')
  const events = []
  let idx = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    idx += 1
    try { events.push({ index: idx, ...JSON.parse(trimmed) }) }
    catch { /* skip malformed lines silently */ }
  }
  return events
}

function findSnippet(name) {
  for (const tier of TIERS) {
    const p = join(ROOT, tier, `${name}.ts`)
    if (existsSync(p)) return { name, tier, path: p }
  }
  return null
}

async function loadSnippetRunSource(snippetName) {
  const found = findSnippet(snippetName)
  if (!found) die(`snippet "${snippetName}" not found in any tier — spec generation needs the source`, 1)
  const mod = await import(pathToFileURL(found.path).href + `?t=${Date.now()}`)
  if (typeof mod.run !== 'function') die(`snippet "${snippetName}" has no run() function`)
  return { source: mod.run.toString(), tier: found.tier }
}

function contentHash(source) {
  return createHash('sha1').update(source).digest('hex').slice(0, 8)
}

// Credential-redaction heuristics.
const CRED_KEY_RE = /(password|passwd|token|secret|api[_-]?key|apikey|bearer|auth(?!or))/i
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const LONG_RANDOM_RE = /^[A-Za-z0-9+/=_-]{40,}$/

function envNameFor(key) {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

function redactArgs(args, stepIndex) {
  const envVars = []
  const redacted = {}
  for (const [key, value] of Object.entries(args || {})) {
    let needsRedaction = false
    let reason = null
    if (CRED_KEY_RE.test(key)) {
      needsRedaction = true
      reason = `credential-shaped key name "${key}"`
    } else if (typeof value === 'string' && JWT_RE.test(value)) {
      needsRedaction = true
      reason = `value looks like a JWT`
    } else if (typeof value === 'string' && LONG_RANDOM_RE.test(value) && value.length >= 40) {
      needsRedaction = true
      reason = `long random-looking string (possible secret)`
    }
    if (needsRedaction) {
      const envName = envNameFor(key)
      envVars.push({ envName, key, reason, stepIndex })
      redacted[key] = { __env: envName }
    } else {
      redacted[key] = value
    }
  }
  return { redacted, envVars }
}

// Resolve a session id from explicit arg → opts.sessionId → env. Returns null if none.
function resolveSessionId(explicit, opts) {
  return explicit || (opts && opts.sessionId) || process.env.CLAUDE_CODE_SESSION_ID || null
}

// Derive a kebab-case label from the step list. Single step → snippet name.
// Multi-step → `<first>-then-<last>`. Fallback → forge-spec-<timestamp>.
function deriveLabel(stepEvents) {
  if (!stepEvents || stepEvents.length === 0) return `forge-spec-${Date.now()}`
  if (stepEvents.length === 1) return stepEvents[0].snippet
  const first = stepEvents[0].snippet
  const last = stepEvents[stepEvents.length - 1].snippet
  return `${first}-then-${last}`
}

// Propose ONE terminal assertion based on the final retained step's result shape.
// Returns null when the snippet had no meaningful return (side-effect-only).
// The varName follows buildSpec's `step<N>Result` naming where N is the step's
// 1-based position in the filtered step list.
function proposeAssertion(lastStep, varIndex) {
  if (!lastStep) return null
  const { result, hadResult } = lastStep
  if (!hadResult) return null
  const v = `step${varIndex}Result`
  if (result === null) return `expect(${v}).toBeNull()`
  if (typeof result === 'boolean') return `expect(${v}).toBe(${result})`
  if (typeof result === 'number') {
    if (result > 0) return `expect(${v}).toBeGreaterThan(0)`
    if (result < 0) return `expect(${v}).toBeLessThan(0)`
    return `expect(${v}).toBe(0)`
  }
  if (typeof result === 'string') {
    if (result.length === 0) return `expect(${v}).toBe('')`
    // Pick the first 4+ char word as a stable substring.
    const m = result.match(/[A-Za-z]{4,}/)
    if (m) return `expect(${v}).toContain(${JSON.stringify(m[0])})`
    return `expect(${v}).toMatch(/.+/)`
  }
  if (Array.isArray(result)) return `expect(${v}.length).toBeGreaterThan(0)`
  if (typeof result === 'object') {
    // Pick the first string field whose value has a stable substring.
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string' && value.length > 0) {
        const m = value.match(/[A-Za-z]{4,}/)
        if (m) return `expect(${v}.${key}).toContain(${JSON.stringify(m[0])})`
      }
    }
    // Fallback: assert the first field exists.
    const firstKey = Object.keys(result)[0]
    if (firstKey) return `expect(${v}.${firstKey}).toBeDefined()`
  }
  return null
}

function formatArgsObject(args, indent = '    ') {
  const entries = Object.entries(args)
  if (entries.length === 0) return '{}'
  const lines = entries.map(([k, v]) => {
    if (v && typeof v === 'object' && v.__env) {
      return `${indent}  ${JSON.stringify(k)}: process.env.${v.__env}`
    }
    return `${indent}  ${JSON.stringify(k)}: ${JSON.stringify(v)}`
  })
  return `{\n${lines.join(',\n')},\n${indent}}`
}

async function buildSpec(transcript, options) {
  const { startAt = 1, drop = [], assertions = [], label, sessionId } = options
  if (!label) die('write requires a label', 2)

  const dropSet = new Set(drop)
  const retained = transcript.filter(e => e.index >= startAt && !dropSet.has(e.index))
  if (retained.length === 0) die('no events retained after applying startAt and drop')

  // Only invoke/authored events become spec steps.
  const steps = retained.filter(e => e.event === 'invoked' || e.event === 'authored')
  if (steps.length === 0) die('no invocable events in slice — need at least one invoked or authored event')

  const envVarsAll = []
  const stepBlocks = []

  for (let i = 0; i < steps.length; i++) {
    const e = steps[i]
    const { source: runSource, tier } = await loadSnippetRunSource(e.snippet)
    const hash = contentHash(runSource)
    const { redacted, envVars } = redactArgs(e.args, i + 1)
    envVarsAll.push(...envVars)
    stepBlocks.push({ index: i + 1, snippet: e.snippet, tier, hash, runSource, args: redacted, hadResult: e.hadResult })
  }

  // Assemble the .spec.ts source.
  const lines = []
  lines.push(`// Generated by forge from session ${sessionId} at ${new Date().toISOString()}`)
  lines.push(`// Recipe: ${label}`)
  lines.push(`// Source events:`)
  for (const s of stepBlocks) lines.push(`//   ${s.index}. ${s.snippet} (${s.tier}) @ ${s.hash}`)
  if (envVarsAll.length > 0) {
    lines.push(`//`)
    lines.push(`// Required environment variables (add to .env / .env.example):`)
    for (const v of envVarsAll) {
      lines.push(`//   ${v.envName} — ${v.reason} [step ${v.stepIndex}, key "${v.key}"]`)
    }
  }
  lines.push(``)
  lines.push(`import { test, expect } from '@playwright/test'`)
  lines.push(``)
  lines.push(`test(${JSON.stringify(label)}, async ({ page }) => {`)

  for (const s of stepBlocks) {
    lines.push(``)
    lines.push(`  // Step ${s.index}: ${s.snippet}  (inlined from ${s.tier}/ — content-hash: ${s.hash})`)
    lines.push(`  const step${s.index}Result = await (async () => {`)
    lines.push(`    const args = ${formatArgsObject(s.args, '    ')}`)
    lines.push(`    const __step = ${s.runSource}`)
    lines.push(`    return await __step(page, args)`)
    lines.push(`  })()`)
  }

  if (assertions.length > 0) {
    lines.push(``)
    lines.push(`  // Assertions`)
    for (const a of assertions) {
      // Each assertion is a raw statement from the skill (e.g. `expect(step3Result).toBe(...)`)
      const trimmed = String(a).trim().replace(/;?$/, '')
      lines.push(`  ${trimmed}`)
    }
  }

  lines.push(`})`)
  lines.push(``)
  return lines.join('\n')
}

function writeSpecFile(label, source) {
  const dir = join(ROOT, 'specs')
  mkdirSync(dir, { recursive: true })
  // Filename: kebab-case label, .spec.ts
  const safe = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'forge-spec'
  const path = join(dir, `${safe}.spec.ts`)
  const tmp = path + '.tmp'
  writeFileSync(tmp, source, 'utf8')
  renameSync(tmp, path)
  return path
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  switch (cmd) {
    case 'events': {
      const sessionId = rest[0] || process.env.CLAUDE_CODE_SESSION_ID
      if (!sessionId) die('events: pass a session-id or set CLAUDE_CODE_SESSION_ID', 2)
      const transcript = loadTranscript(sessionId)
      process.stdout.write(JSON.stringify(transcript, null, 2) + '\n')
      return
    }
    case 'write': {
      // `write '<opts>'` — opts is optional; every field has a sensible default.
      // Session-id is resolved from opts.sessionId → CLAUDE_CODE_SESSION_ID env.
      let opts = {}
      if (rest[0]) {
        try { opts = JSON.parse(rest[0]) } catch { die('write options must be valid JSON', 2) }
      }
      const sessionId = opts.sessionId || process.env.CLAUDE_CODE_SESSION_ID
      if (!sessionId) die('write: CLAUDE_CODE_SESSION_ID not set and no sessionId in opts', 1)

      const transcript = loadTranscript(sessionId)
      const startAt = typeof opts.startAt === 'number' ? opts.startAt : 1
      const dropSet = new Set(opts.drop || [])
      const retained = transcript.filter(e => e.index >= startAt && !dropSet.has(e.index))
      const stepEvents = retained.filter(e => e.event === 'invoked' || e.event === 'authored')
      if (stepEvents.length === 0) die('write: no invocable events in slice (need at least one invoked or authored event)', 1)

      const label = opts.label || deriveLabel(stepEvents)

      let assertions = Array.isArray(opts.assertions) ? opts.assertions.slice() : []
      let proposedAssertion = null
      if (!opts.skipAssertion && assertions.length === 0) {
        const lastStep = stepEvents[stepEvents.length - 1]
        proposedAssertion = proposeAssertion(lastStep, stepEvents.length)
        if (proposedAssertion) assertions = [proposedAssertion]
      }

      const source = await buildSpec(transcript, { startAt, drop: opts.drop || [], assertions, label, sessionId })
      const path = writeSpecFile(label, source)

      const snippets = stepEvents.map(e => e.snippet)
      const summary = `Wrote spec '${label}' with ${stepEvents.length} step(s) [${snippets.join(' → ')}]` +
        (proposedAssertion ? ` and 1 auto-proposed assertion` : ' (no assertion proposed)') +
        ` → ${path}`

      process.stdout.write(JSON.stringify({
        ok: true,
        path,
        label,
        stepCount: stepEvents.length,
        snippets,
        proposedAssertion,
        summary,
      }, null, 2) + '\n')
      return
    }
    default:
      die('usage: forge-spec.mjs <events|write> [json-options]', 2)
  }
}

main().catch(err => {
  console.error('forge-spec: unexpected error:', err && err.stack || err)
  process.exit(4)
})
