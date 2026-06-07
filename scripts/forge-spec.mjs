#!/usr/bin/env node
// forge-spec.mjs — synthesise a Playwright .spec.ts from a session transcript slice.
//
// Subcommands:
//   events <session-id>
//     Read $FORGE_ROOT/sessions/<session-id>.jsonl and print a JSON array of
//     events with display-friendly fields (1-indexed, snippet, args, result, hadResult).
//     Used by the skill to present the slice to the user.
//
//   write <session-id> '<options-json>'
//     Build and write a .spec.ts to $FORGE_ROOT/specs/<label>.spec.ts.
//     options-json = { startAt?: number, drop?: number[], assertions?: string[], label: string }
//     - startAt defaults to 1 (first event)
//     - drop is a list of 1-indexed event indices to skip
//     - assertions is an array of raw expect(...) statement strings (the skill
//       converts user freeform NL into these)
//     - label is required and used as the filename + test description
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
      const sessionId = rest[0]
      if (!sessionId) die('events requires a session-id', 2)
      const transcript = loadTranscript(sessionId)
      process.stdout.write(JSON.stringify(transcript, null, 2) + '\n')
      return
    }
    case 'write': {
      const sessionId = rest[0]
      if (!sessionId) die('write requires a session-id', 2)
      let opts = {}
      if (rest[1]) {
        try { opts = JSON.parse(rest[1]) } catch { die('write options must be valid JSON', 2) }
      }
      const transcript = loadTranscript(sessionId)
      const source = await buildSpec(transcript, { ...opts, sessionId })
      const path = writeSpecFile(opts.label, source)
      process.stdout.write(JSON.stringify({ ok: true, path, label: opts.label }) + '\n')
      return
    }
    default:
      die('usage: forge-spec.mjs <events|write> <session-id> [json-options]', 2)
  }
}

main().catch(err => {
  console.error('forge-spec: unexpected error:', err && err.stack || err)
  process.exit(4)
})
