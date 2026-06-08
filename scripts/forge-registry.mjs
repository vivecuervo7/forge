#!/usr/bin/env node
// forge-registry.mjs — the snippet registry.
//
// Subcommands:
//   list                      List every snippet across tiers (JSON to stdout)
//   show <name>               Print one snippet's metadata + path
//   reindex                   Regenerate ~/.claude/.vive-claude/forge/INDEX.md
//   invoke <name> [json-args] Run the snippet against the 'forge' playwright-cli session
//                             (precondition check + run + stats bump + history + auto-promote)
//   record-authoring <name> [json-result]
//                             Record that the snippet was authored AND first-used during a drive.
//                             Initialises stats (useCount: 1), appends an 'authored' event to
//                             history, regenerates INDEX.md. Avoids double-execution on first
//                             encounter — the agent's drive IS the first use.
//   delete <name> [--force]   Remove the snippet file, its history.jsonl, and its stats entry;
//                             regenerate INDEX.md. Refuses on library/ and staged/ without --force.
//   prune [--dry-run]         Apply TTL lifecycle: prune unused scratch (default 7d), demote
//                             unused staged → scratch (default 60d), report stale library
//                             entries (default 90d, never auto-deleted). --dry-run lists what
//                             would happen without applying.
//   drive <playwright-cli args...>
//                             Run `playwright-cli -s=forge <args>` and record the equivalent
//                             Playwright code to the session transcript. Used by the driver
//                             agent to capture inline driving for spec generation. Read-only
//                             commands (snapshot, tab-list, url) are passed through without
//                             recording.
//   capture '<json>' [--force]
//                             Append a `capture` event to the session transcript. Emitted
//                             by the driver agent at the end of each logical chunk it wants
//                             saved as a snippet. JSON shape:
//                               { name: kebab-case-string,
//                                 description: string,
//                                 preconditions?: { url?: regex-source-string,
//                                                   visible?: string | string[] },
//                                 args?: object }
//                             The capture event acts as a closing bracket: drove events
//                             between the previous capture (or session start) and this one
//                             form the snippet body. No drove events in window → nothing
//                             saved. No capture call at all → nothing saved.
//                             Two guardrails refuse the capture (override with --force):
//                               - buffer contains events from >1 hostname (likely batched
//                                 captures; should be inline per-chunk)
//                               - last run-code returned a failure-shaped value (null, [],
//                                 "Not found", etc.; should discard instead)
//   discard '<reason>'        Append a `discard` event to the transcript. Closes the
//                             current capture window like `capture` does but writes no
//                             snippet — used by the driver to throw away exploratory or
//                             recovery actions before retrying a chunk cleanly. The reason
//                             is recorded in the transcript for forensics.
//   collate [session-id]      Post-driver pass: walk the transcript, write one snippet per
//                             capture event using the drove events in its window as the
//                             body. Pure transcription — naming and intent are the driver's
//                             call, not the script's. Session id defaults to
//                             $CLAUDE_CODE_SESSION_ID.
//
// Tier promotion:
//   useCount >= STAGE_AT   (default 2) → promote to staged
//   useCount >= LIBRARY_AT (default 3) → promote to library
//   Promotion runs automatically after every successful invoke / record-authoring.
//   Override via FORGE_STAGE_AT and FORGE_LIBRARY_AT env vars.
//
// TTLs:
//   FORGE_SCRATCH_TTL_DAYS   (default 7)   scratch → delete if unused for N days
//   FORGE_STAGED_TTL_DAYS    (default 60)  staged → demote to scratch if unused for N days
//   FORGE_LIBRARY_STALE_DAYS (default 90)  library → report stale (never auto-delete)
//
// Invocation shells out to `playwright-cli -s=forge run-code "..."`. The
// snippet's run(page, args) body is extracted via .toString() after dynamic
// import (Node 24 type-strips natively), precondition checks are prepended,
// args are inlined as a const, and the whole thing is wrapped as an
// `async page => { ... }` arrow for run-code.
//
// History events are appended to <snippet>.history.jsonl in the snippet's tier dir.
// stats.json is updated atomically (read → mutate → write).

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, appendFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.FORGE_ROOT || join(homedir(), '.claude/.vive-claude/forge')
const SESSION = process.env.FORGE_SESSION || 'forge'
const TIERS = ['library', 'staged', 'scratch', 'broken']
const STATS_PATH = join(ROOT, 'stats.json')
const INDEX_PATH = join(ROOT, 'INDEX.md')

const STAGE_AT = Number(process.env.FORGE_STAGE_AT || 2)
const LIBRARY_AT = Number(process.env.FORGE_LIBRARY_AT || 3)
const SCRATCH_TTL_MS = Number(process.env.FORGE_SCRATCH_TTL_DAYS || 7) * 86_400_000
const STAGED_TTL_MS = Number(process.env.FORGE_STAGED_TTL_DAYS || 60) * 86_400_000
const LIBRARY_STALE_MS = Number(process.env.FORGE_LIBRARY_STALE_DAYS || 90) * 86_400_000

function die(msg, code = 1) {
  console.error('forge-registry:', msg)
  process.exit(code)
}

function nowIso() { return new Date().toISOString() }

function readStats() {
  if (!existsSync(STATS_PATH)) return {}
  try { return JSON.parse(readFileSync(STATS_PATH, 'utf8')) } catch { return {} }
}

function writeStats(stats) {
  const tmp = STATS_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(stats, null, 2) + '\n', 'utf8')
  renameSync(tmp, STATS_PATH)
}

function appendHistory(tierDir, name, event) {
  const path = join(tierDir, `${name}.history.jsonl`)
  appendFileSync(path, JSON.stringify({ ts: nowIso(), ...event }) + '\n', 'utf8')
}

// Append a single event to the current Claude session's transcript so that
// `/forge spec` has a chronological view of what happened in this session.
// Silently no-ops when CLAUDE_CODE_SESSION_ID isn't set (running outside
// Claude Code, in a test harness, etc.). Recovery / improvisation is NOT
// recorded here — the transcript only carries clean intent-level events.
function appendTranscript(event) {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) return
  const dir = join(ROOT, 'sessions')
  try { mkdirSync(dir, { recursive: true }) } catch {}
  const path = join(dir, `${sessionId}.jsonl`)
  try {
    appendFileSync(path, JSON.stringify({ ts: nowIso(), ...event }) + '\n', 'utf8')
  } catch {
    // Transcript failures should never break invocation.
  }
}

// Move a snippet (.ts + .history.jsonl) between tier directories. Returns the new path.
function moveSnippet(name, fromTier, toTier) {
  const fromDir = join(ROOT, fromTier)
  const toDir = join(ROOT, toTier)
  const tsFrom = join(fromDir, `${name}.ts`)
  const tsTo = join(toDir, `${name}.ts`)
  const histFrom = join(fromDir, `${name}.history.jsonl`)
  const histTo = join(toDir, `${name}.history.jsonl`)
  if (existsSync(tsFrom)) renameSync(tsFrom, tsTo)
  if (existsSync(histFrom)) renameSync(histFrom, histTo)
  return tsTo
}

// Resolve the target tier for a snippet based on its useCount.
// Returns null if no promotion is warranted from the current tier.
function targetTierFor(currentTier, useCount) {
  if (currentTier === 'broken') return null // quarantined; promotion shouldn't move it
  if (useCount >= LIBRARY_AT && currentTier !== 'library') return 'library'
  if (useCount >= STAGE_AT && currentTier !== 'library' && currentTier !== 'staged') return 'staged'
  return null
}

// Apply auto-promotion if warranted. Mutates the stats entry in place and moves files.
// Caller is responsible for writeStats() after.
function maybePromote(name, statsEntry, sessionId) {
  const next = targetTierFor(statsEntry.tier, statsEntry.useCount)
  if (!next) return null
  const from = statsEntry.tier
  moveSnippet(name, from, next)
  statsEntry.tier = next
  appendHistory(join(ROOT, next), name, {
    event: 'promoted',
    from,
    to: next,
    useCount: statsEntry.useCount,
    sessionId,
  })
  return { from, to: next }
}

function listSnippets() {
  const out = []
  for (const tier of TIERS) {
    const dir = join(ROOT, tier)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue
      const name = file.slice(0, -3)
      const path = join(dir, file)
      const st = statSync(path)
      out.push({ name, tier, path, sizeBytes: st.size, mtime: st.mtime.toISOString() })
    }
  }
  return out
}

function regenerateIndex() {
  const snippets = listSnippets()
  const byTier = { library: [], staged: [], scratch: [], broken: [] }
  const descriptions = new Map()

  // Light parse — grab the first `description: '...'` line from each file.
  // Cheap and good enough for an index; full module load happens only on invoke.
  for (const s of snippets) {
    let desc = '(no description)'
    try {
      const src = readFileSync(s.path, 'utf8')
      const m = src.match(/description\s*:\s*['"`]([^'"`]+)['"`]/)
      if (m) desc = m[1]
    } catch {}
    descriptions.set(s.name, desc)
    byTier[s.tier].push(s.name)
  }

  let md = '# Forge snippet index\n\n'
  md += '_Auto-generated by `forge-registry.mjs reindex`. Do not edit by hand._\n\n'

  const total = snippets.length
  if (total === 0) {
    md += 'No snippets yet.\n'
  } else {
    for (const tier of ['library', 'staged', 'scratch', 'broken']) {
      const names = byTier[tier].sort()
      if (names.length === 0) continue
      md += `## ${tier} (${names.length})\n\n`
      for (const n of names) {
        md += `- \`${n}\` — ${descriptions.get(n)}\n`
      }
      md += '\n'
    }
  }

  const tmp = INDEX_PATH + '.tmp'
  writeFileSync(tmp, md, 'utf8')
  renameSync(tmp, INDEX_PATH)
  return { count: total, path: INDEX_PATH }
}

function findSnippet(name) {
  for (const tier of TIERS) {
    const path = join(ROOT, tier, `${name}.ts`)
    if (existsSync(path)) return { name, tier, path }
  }
  return null
}

// Serialise a RegExp to its source form for embedding in a JS string literal context.
function regexLiteral(re) {
  if (re instanceof RegExp) return `new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)})`
  return `new RegExp(${JSON.stringify(String(re))})`
}

// Build JS snippets that check meta.preconditions at the top of the run-code body.
// On failure, throw an Error whose message begins with "precondition:" so the
// caller can distinguish precondition failures from run failures.
//
// The URL precondition is gated on `__wrOpenedFresh` — when the wrapper just
// opened a new tab because no existing one matched, the snippet is expected to
// navigate via its own page.goto(...). Enforcing the URL precondition against
// an about:blank in that case would defeat the snippet before it gets to run.
// `visible` checks still apply unconditionally.
function buildPreconditionChecks(preconditions) {
  if (!preconditions) return ''
  const checks = []

  if (preconditions.url) {
    checks.push(`if (!__wrOpenedFresh) {
  const __re = ${regexLiteral(preconditions.url)};
  const __u = page.url();
  if (!__re.test(__u)) throw new Error('precondition: url expected ' + __re + ' but on ' + __u);
}`)
  }

  if (preconditions.visible) {
    const texts = Array.isArray(preconditions.visible) ? preconditions.visible : [preconditions.visible]
    for (const t of texts) {
      checks.push(`{
  const __visible = await page.getByText(${JSON.stringify(String(t))}).first().isVisible().catch(() => false);
  if (!__visible) throw new Error('precondition: text not visible: ' + ${JSON.stringify(String(t))});
}`)
    }
  }

  return checks.join('\n')
}

function ensureSession() {
  // Lightweight check: does `playwright-cli list` mention our session?
  // `playwright-cli list` formats sessions as `- forge:` so we need a
  // boundary that accepts non-word characters (colon, comma, EOL) — \b is
  // exactly that.
  const r = spawnSync('playwright-cli', ['list'], { encoding: 'utf8' })
  if (r.status !== 0) {
    die(`playwright-cli list failed: ${r.stderr || r.stdout || 'unknown error'}`, 1)
  }
  const re = new RegExp(`\\b${SESSION}\\b`)
  if (!re.test(r.stdout)) {
    die(`playwright-cli session "${SESSION}" not active — run forge-session.sh first`, 1)
  }
}

function pruneStale(dryRun) {
  const stats = readStats()
  const now = Date.now()
  const actions = { pruned: [], demoted: [], promoted: [], stale: [] }

  // Reconcile any snippets whose useCount has overrun their tier (e.g. manual
  // stats edits, or thresholds tightened since last invoke). Idempotent.
  for (const [name, entry] of Object.entries(stats)) {
    const target = targetTierFor(entry.tier, entry.useCount)
    if (!target) continue
    const from = entry.tier
    if (dryRun) {
      actions.promoted.push({ name, from, to: target, useCount: entry.useCount, reason: 'reconcile' })
      continue
    }
    moveSnippet(name, from, target)
    appendHistory(join(ROOT, target), name, {
      event: 'promoted',
      from,
      to: target,
      useCount: entry.useCount,
      reason: 'reconcile',
    })
    entry.tier = target
    actions.promoted.push({ name, from, to: target, useCount: entry.useCount, reason: 'reconcile' })
  }

  // Apply TTL rules.
  for (const [name, entry] of Object.entries({ ...stats })) {
    if (!stats[name]) continue // may have been deleted by an earlier iteration
    const lastUsedMs = entry.lastUsed ? Date.parse(entry.lastUsed) : 0
    const age = now - lastUsedMs

    if (entry.tier === 'scratch' && age > SCRATCH_TTL_MS && entry.useCount < STAGE_AT) {
      // Scratch + stale + never reused → delete entirely.
      if (dryRun) {
        actions.pruned.push({ name, ageDays: Math.round(age / 86_400_000), useCount: entry.useCount })
        continue
      }
      const tierDir = join(ROOT, 'scratch')
      const tsPath = join(tierDir, `${name}.ts`)
      const histPath = join(tierDir, `${name}.history.jsonl`)
      if (existsSync(tsPath)) unlinkSync(tsPath)
      if (existsSync(histPath)) unlinkSync(histPath)
      delete stats[name]
      actions.pruned.push({ name, ageDays: Math.round(age / 86_400_000), useCount: entry.useCount })
    } else if (entry.tier === 'staged' && age > STAGED_TTL_MS) {
      // Staged + stale → demote to scratch (gives it a final scratch TTL window).
      if (dryRun) {
        actions.demoted.push({ name, ageDays: Math.round(age / 86_400_000), from: 'staged', to: 'scratch' })
        continue
      }
      moveSnippet(name, 'staged', 'scratch')
      appendHistory(join(ROOT, 'scratch'), name, {
        event: 'demoted',
        from: 'staged',
        to: 'scratch',
        reason: 'staged-ttl-exceeded',
        ageDays: Math.round(age / 86_400_000),
      })
      entry.tier = 'scratch'
      actions.demoted.push({ name, ageDays: Math.round(age / 86_400_000), from: 'staged', to: 'scratch' })
    } else if (entry.tier === 'library' && age > LIBRARY_STALE_MS) {
      // Library never auto-deletes. Just flag for caller review.
      actions.stale.push({ name, ageDays: Math.round(age / 86_400_000) })
    }
  }

  if (!dryRun) {
    writeStats(stats)
    if (actions.pruned.length || actions.demoted.length || actions.promoted.length) {
      regenerateIndex()
    }
  }

  return actions
}

function deleteSnippet(name, force) {
  const found = findSnippet(name)
  if (!found) die(`snippet not found: ${name}`, 1)

  if ((found.tier === 'library' || found.tier === 'staged') && !force) {
    die(`refusing to delete snippet "${name}" from ${found.tier}/ without --force (promoted snippets represent earned reuse)`, 1)
  }

  const tierDir = join(ROOT, found.tier)
  const tsPath = found.path
  const historyPath = join(tierDir, `${name}.history.jsonl`)

  const removed = []
  if (existsSync(tsPath)) { unlinkSync(tsPath); removed.push(tsPath) }
  if (existsSync(historyPath)) { unlinkSync(historyPath); removed.push(historyPath) }

  const stats = readStats()
  const hadStats = Object.prototype.hasOwnProperty.call(stats, name)
  if (hadStats) {
    delete stats[name]
    writeStats(stats)
  }

  const { count, path } = regenerateIndex()
  process.stdout.write(JSON.stringify({
    ok: true,
    name,
    tier: found.tier,
    removed,
    statsRemoved: hadStats,
    indexCount: count,
    indexPath: path,
  }) + '\n')
}

function recordAuthoring(name, result) {
  const found = findSnippet(name)
  if (!found) die(`snippet not found: ${name}`, 1)
  if (found.tier !== 'scratch') {
    die(`record-authoring expects snippet in scratch/, found in ${found.tier}/`, 1)
  }

  const sessionId = process.env.FORGE_SESSION_ID || null
  const stats = readStats()
  if (stats[name] && stats[name].useCount > 0) {
    // Idempotency guard: if useCount is already >= 1, don't reset. Re-recording would
    // erase real history. Just append a fresh authored event for the record.
    appendHistory(join(ROOT, found.tier), name, {
      event: 'authored',
      result,
      sessionId,
      note: 'record-authoring called on snippet that already had useCount > 0',
    })
    const { count, path } = regenerateIndex()
    process.stdout.write(JSON.stringify({
      ok: true, name, path: found.path, useCount: stats[name].useCount, indexCount: count, indexPath: path,
      warning: 'snippet already had useCount > 0; left as-is',
    }) + '\n')
    return
  }

  stats[name] = {
    tier: found.tier,
    useCount: 1,
    lastUsed: nowIso(),
    createdAt: nowIso(),
  }
  appendHistory(join(ROOT, found.tier), name, {
    event: 'authored',
    result,
    sessionId,
  })
  appendTranscript({
    event: 'authored',
    snippet: name,
    tier: found.tier,
    result,
    hadResult: result !== null && result !== undefined,
  })

  // Auto-promote in case thresholds are configured aggressively (e.g. STAGE_AT=1).
  // For default thresholds (STAGE_AT=2), useCount=1 doesn't trigger anything.
  const promotion = maybePromote(name, stats[name], sessionId)
  writeStats(stats)

  const { count, path: indexPath } = regenerateIndex()
  process.stdout.write(JSON.stringify({
    ok: true,
    name,
    path: join(ROOT, stats[name].tier, `${name}.ts`),
    useCount: 1,
    tier: stats[name].tier,
    promoted: promotion,
    indexCount: count,
    indexPath,
  }) + '\n')
}

// Run `playwright-cli -s=forge <args>` and record the equivalent Playwright code
// to the session transcript, so the spec-generation pipeline can capture inline
// driving as part of the spec. Read-only commands that emit no `### Ran Playwright
// code` block (snapshot, tab-list, url) are silently passed through without
// recording — they don't contribute to a reproducible test.
async function driveAction(args) {
  if (!args || args.length === 0) die('drive: pass playwright-cli args', 2)
  ensureSession()
  const r = spawnSync('playwright-cli', [`-s=${SESSION}`, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const stdout = r.stdout || ''
  const stderr = r.stderr || ''

  // Extract the executable code emitted by playwright-cli for this action.
  // The format is:
  //   ### Ran Playwright code
  //   ```js
  //   <one or more await statements>
  //   ```
  const codeMatch = stdout.match(/### Ran Playwright code\n```js\n([\s\S]*?)\n```/)
  const code = codeMatch ? codeMatch[1].trim() : null

  // Some commands (snapshot, run-code, eval) also have a "### Result" block.
  // run-code is the only one whose result we care about preserving — extraction
  // logic the user wrote (or the agent wrote) to capture a value. We embed it
  // for spec replay alongside the code.
  let result = null
  const resultMatch = stdout.match(/### Result\n([\s\S]*?)(?:\n### Ran Playwright code|$)/)
  if (resultMatch) {
    const raw = resultMatch[1].trim()
    if (raw) {
      try { result = JSON.parse(raw) } catch { result = raw }
    }
  }

  // If there's no executable code to record, this was a read-only command
  // (snapshot, tab-list, url, etc.). Pass through silently.
  if (code) {
    appendTranscript({
      event: 'drove',
      command: args[0],
      code,
      result,
    })
  }

  // Forward the playwright-cli output to stdout so the caller sees what happened.
  process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  process.exit(r.status || 0)
}

// Walk the session transcript and return drove events accumulated since the
// last capture/discard (or session start). Used by recordCapture's guardrails
// to refuse cross-domain buffers and failure-shaped last results without
// having to teach the driver to inspect the transcript itself.
function inspectCaptureBuffer(sessionId) {
  const transcriptPath = join(ROOT, 'sessions', `${sessionId}.jsonl`)
  if (!existsSync(transcriptPath)) return []
  const buffer = []
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let e
    try { e = JSON.parse(trimmed) } catch { continue }
    if (e.event === 'drove') buffer.push(e)
    else buffer.length = 0  // capture, discard, invoked, authored — flush
  }
  return buffer
}

// Extract distinct hostnames from URL literals in drove events' code. Used to
// detect cross-domain buffers (multiple goto destinations within one capture
// window — almost certainly a missed inline-capture).
function bufferHostnames(droveEvents) {
  const hosts = new Set()
  for (const e of droveEvents) {
    if (typeof e.code !== 'string') continue
    const matches = e.code.matchAll(/['"`](https?:\/\/[^'"`]+)['"`]/g)
    for (const m of matches) {
      try { hosts.add(new URL(m[1]).hostname.replace(/^www\./, '')) } catch {}
    }
  }
  return [...hosts]
}

// Heuristic check on the last run-code's result: does it look like a failed
// extraction? Catches the pattern where the driver tried to read a value, got
// nothing back, and then captured the failed chunk anyway.
function failureLikeResult(droveEvents) {
  const runCodes = droveEvents.filter(e => e.command === 'run-code')
  if (runCodes.length === 0) return null
  const last = runCodes[runCodes.length - 1]
  const r = last.result
  if (r === null || r === undefined) return 'null/undefined'
  if (Array.isArray(r) && r.length === 0) return '[] (empty array)'
  if (typeof r === 'string') {
    const trimmed = r.trim()
    if (trimmed === '') return '"" (empty string)'
    if (/^(not found|undefined|null)$/i.test(trimmed)) return JSON.stringify(trimmed.slice(0, 60))
    if (/^error\b/i.test(trimmed)) return JSON.stringify(trimmed.slice(0, 60))
  }
  return null
}

// Append a `capture` event to the session transcript. The driver agent calls
// this after each logical chunk it wants saved as a snippet — naming, intent,
// and preconditions all come from the driver, not from heuristics. The event
// acts as a closing bracket: drove events between the previous capture (or
// session start) and this one form the snippet body at collate time.
//
// Two guardrails run before the event is appended (skippable with --force):
//   1. Cross-domain buffer: events span >1 hostname → almost certainly a
//      missed inline-capture; refuse with a hint to capture per-chunk.
//   2. Failure-shaped last result: last run-code returned null/[]/"Not found"
//      → almost certainly a failed extraction; refuse with a hint to discard.
function recordCapture(metaJson, force) {
  let meta
  try { meta = JSON.parse(metaJson) }
  catch (e) { die(`capture: meta must be valid JSON: ${e.message}`, 2) }
  if (typeof meta !== 'object' || meta === null) die('capture: meta must be a JSON object', 2)
  if (typeof meta.name !== 'string' || !meta.name) die('capture: meta.name (string) required', 2)
  if (!/^[a-z][a-z0-9-]*$/.test(meta.name)) {
    die(`capture: name "${meta.name}" must be lowercase kebab-case (a-z, 0-9, -, starting with letter)`, 2)
  }
  if (typeof meta.description !== 'string' || !meta.description) die('capture: meta.description (string) required', 2)

  // Guardrails — run only when we can see the transcript and only when the
  // driver hasn't explicitly overridden via --force.
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!force && sessionId) {
    const buffer = inspectCaptureBuffer(sessionId)
    const hosts = bufferHostnames(buffer)
    if (hosts.length > 1) {
      die(
        `capture refused: buffer contains drove events from ${hosts.length} hostnames (${hosts.join(', ')}).\n` +
        `  This usually means you batched captures at the end instead of calling capture immediately\n` +
        `  after each chunk. Capture is end-anchored — it sweeps every drove event back to the previous\n` +
        `  capture/discard. Fix: discard the buffer ('explored multiple sites in one window'), then\n` +
        `  redo the work with capture inline after each chunk. To override (rare; you really mean a\n` +
        `  cross-domain snippet), retry with --force.`,
        3,
      )
    }
    const failure = failureLikeResult(buffer)
    if (failure !== null) {
      die(
        `capture refused: the last buffered run-code returned ${failure}, which looks like a failed\n` +
        `  extraction. Capturing it would write a snippet that returns the failure value on every\n` +
        `  future invocation. Fix: call discard '<reason>' instead, then retry the chunk with a working\n` +
        `  extraction approach. To override (rare; the failure-shaped result is what you actually mean\n` +
        `  to capture), retry with --force.`,
        3,
      )
    }
  }

  appendTranscript({
    event: 'capture',
    name: meta.name,
    description: meta.description,
    preconditions: meta.preconditions || null,
    args: meta.args || null,
  })
  process.stdout.write(JSON.stringify({ ok: true, name: meta.name }) + '\n')
}

// Append a `discard` event — closes the current capture window without writing
// a snippet. The driver calls this when a chunk goes sideways (bad search,
// wrong element clicked, recovery needed) and the accumulated drove events
// shouldn't pollute whatever the next capture covers.
function recordDiscard(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    die('discard requires a reason string (one-line, what went wrong)', 2)
  }
  appendTranscript({
    event: 'discard',
    reason: reason.trim(),
  })
  process.stdout.write(JSON.stringify({ ok: true, reason: reason.trim() }) + '\n')
}

// Post-driver pass: walk the session transcript, emit one snippet per `capture`
// event using the drove events between captures as the body. Pure transcription
// — no chunking heuristics, no name derivation, no precondition inference.
// The driver decides what to save and how to describe it; the script does file
// IO and dedup.
function collateSession(sessionId) {
  const transcriptPath = join(ROOT, 'sessions', `${sessionId}.jsonl`)
  if (!existsSync(transcriptPath)) {
    return { ok: true, sessionId, created: [], skipped: [], reason: 'no transcript' }
  }
  const events = []
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try { events.push(JSON.parse(trimmed)) } catch {}
  }

  // Build chunks: each capture event closes a window of drove events back to
  // the previous capture/discard (or session start). A discard event closes
  // the window without producing a chunk — used to throw away exploratory
  // actions before a clean retry.
  const chunks = []
  const discards = []
  let buffer = []
  for (const e of events) {
    if (e.event === 'drove') {
      buffer.push(e)
    } else if (e.event === 'capture') {
      chunks.push({ capture: e, events: buffer })
      buffer = []
    } else if (e.event === 'discard') {
      discards.push({ reason: e.reason, discardedActionCount: buffer.length })
      buffer = []
    } else {
      // 'invoked', 'authored', etc. — flush the buffer; these aren't part of
      // any chunk (they're either existing snippet invocations or noise).
      buffer = []
    }
  }
  // Tail drove events without a closing capture/discard are dropped by design
  // — the driver chose not to save them.

  // Pre-load existing snippet bodies + names for dedup and collision handling.
  const existingHashes = new Set()
  const existingNames = new Set()
  for (const tier of TIERS) {
    const dir = join(ROOT, tier)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue
      existingNames.add(file.slice(0, -3))
      try {
        const src = readFileSync(join(dir, file), 'utf8')
        const m = src.match(/export async function run[\s\S]*?\{([\s\S]*)\}\s*$/m)
        if (m) existingHashes.add(normaliseCodeForHash(m[1]))
      } catch {}
    }
  }

  const created = []
  const skipped = []

  for (const { capture, events: chunkEvents } of chunks) {
    if (chunkEvents.length === 0) {
      skipped.push({ name: capture.name, reason: 'no-drove-events-in-window' })
      continue
    }
    // Hash on the *transformed* body (post-__result rewrite, with returnLine) —
    // that's what writeSnippetFile will emit, and what we'll read back from
    // existing files. Hashing the raw drove-events body would never dedup
    // since existing files already have the rewrite applied.
    const { body: finalBody, returnLine } = transformChunkBody(chunkEvents)
    const hashTarget = finalBody + returnLine
    const hash = normaliseCodeForHash(hashTarget)
    if (existingHashes.has(hash)) {
      skipped.push({ name: capture.name, reason: 'duplicate-of-existing-body' })
      continue
    }
    // Name collision with a *different* body → numeric suffix.
    let finalName = capture.name
    if (existingNames.has(finalName)) {
      let n = 2
      while (existingNames.has(`${capture.name}-${n}`) && n < 50) n++
      finalName = `${capture.name}-${n}`
    }
    const snippetPath = join(ROOT, 'scratch', `${finalName}.ts`)
    writeSnippetFile(snippetPath, capture, finalBody, returnLine, chunkEvents)
    existingHashes.add(hash)
    existingNames.add(finalName)
    created.push({
      name: finalName,
      path: snippetPath,
      actionCount: chunkEvents.length,
      ...(finalName !== capture.name && { renamedFrom: capture.name }),
    })
  }

  if (created.length > 0) regenerateIndex()

  return { ok: true, sessionId, created, skipped, discards }
}

function normaliseCodeForHash(code) {
  // Strip whitespace + string literal contents so that two functionally
  // equivalent snippets with different literal arg values still match.
  return code
    .replace(/['"`][^'"`]*['"`]/g, "''")
    .replace(/\s+/g, ' ')
    .trim()
}

// Render a `preconditions` block from the driver-supplied capture meta. Falls
// back to the first goto URL when the driver didn't provide one (most chunks
// will have a clear "this only works on $domain" precondition the driver knows).
function renderPreconditions(capture, chunkEvents) {
  const parts = []
  const supplied = capture.preconditions || {}

  if (supplied.url) {
    // Driver provides regex source as a plain string ("news\\.ycombinator\\.com").
    // Render as a regex literal so the snippet loader can use it directly.
    parts.push(`url: /${supplied.url}/`)
  } else {
    const firstGoto = chunkEvents.find(e => e.command === 'goto')
    if (firstGoto) {
      const urlMatch = firstGoto.code.match(/['"`](https?:\/\/[^'"`]+)['"`]/)
      if (urlMatch) {
        try {
          const u = new URL(urlMatch[1])
          parts.push(`url: /${u.hostname.replace(/\./g, '\\.')}/`)
        } catch {}
      }
    }
  }

  if (supplied.visible) {
    const items = Array.isArray(supplied.visible) ? supplied.visible : [supplied.visible]
    if (items.length === 1) parts.push(`visible: ${JSON.stringify(items[0])}`)
    else parts.push(`visible: ${JSON.stringify(items)}`)
  }

  if (parts.length === 0) return '\n  preconditions: {},'
  return '\n  preconditions: {\n    ' + parts.join(',\n    ') + ',\n  },'
}

// Rewrite a chunk's drove events into the body we'll embed in `run(page, args)`.
// If the last event was a run-code that returned a value, transform that event's
// code into `const __result = await ...` and emit a trailing `return __result`.
// Pure function — called from collateSession (for hash dedup) and writeSnippetFile.
//
// Operates per-event rather than via regex on the joined body. A regex spanning
// multiple `await (async page => ...)(page)` IIFEs can bind `__result` to the
// wrong IIFE under non-greedy backtracking; transforming the last event's code
// directly avoids the ambiguity.
function transformChunkBody(chunkEvents) {
  const lastEvent = chunkEvents[chunkEvents.length - 1]
  const hasReturn = lastEvent && lastEvent.command === 'run-code'
    && lastEvent.result !== null && lastEvent.result !== undefined

  if (!hasReturn) {
    return {
      body: chunkEvents.map(e => `  ${e.code}`).join('\n'),
      returnLine: '',
    }
  }

  // Last event's code shape: `await (async page => { ... })(page);` (semicolon
  // and trailing whitespace optional). Capture the inner `(async page => ...)(page)`
  // call expression and rebuild as `const __result = await <expr>;`.
  const m = lastEvent.code.match(/^await (\(async page =>[\s\S]*\)\(page\))\s*;?\s*$/)
  if (!m) {
    // Unexpected shape — fall back to no rewrite; emit the events as-is and
    // skip the return line so the snippet remains valid even though it won't
    // return a value.
    return {
      body: chunkEvents.map(e => `  ${e.code}`).join('\n'),
      returnLine: '',
    }
  }

  const rewrittenLast = `const __result = await ${m[1]};`
  const lines = chunkEvents.slice(0, -1).map(e => `  ${e.code}`)
  lines.push(`  ${rewrittenLast}`)
  return {
    body: lines.join('\n'),
    returnLine: '\n  return __result',
  }
}

function writeSnippetFile(path, capture, finalBody, returnLine, chunkEvents) {
  const preconditionsBlock = renderPreconditions(capture, chunkEvents)
  const argsBlock = capture.args && typeof capture.args === 'object' && Object.keys(capture.args).length > 0
    ? JSON.stringify(capture.args)
    : '{}'

  const src = `// Auto-extracted by forge collation from session drive on ${new Date().toISOString().slice(0, 10)}.
// Driver-supplied name and description; preconditions and body may need tweaking.
export const meta = {
  description: ${JSON.stringify(capture.description)},${preconditionsBlock}
  args: ${argsBlock},
  tags: ['auto-collated'],
}

export async function run(page, args) {
${finalBody}${returnLine}
}
`
  const tmp = path + '.tmp'
  writeFileSync(tmp, src, 'utf8')
  renameSync(tmp, path)
}

async function invokeSnippet(name, args) {
  const found = findSnippet(name)
  if (!found) die(`snippet not found: ${name}`, 1)
  if (found.tier === 'broken') die(`snippet "${name}" is quarantined in broken/ — repair before invoking`, 1)

  ensureSession()

  // Dynamic import to read meta and stringify run.
  let mod
  try {
    mod = await import(pathToFileURL(found.path).href + `?t=${Date.now()}`)
  } catch (e) {
    die(`failed to import snippet "${name}": ${e.message || e}`, 1)
  }
  const meta = mod.meta || {}
  if (typeof mod.run !== 'function') die(`snippet "${name}" does not export a run(page, args) function`, 1)

  const runSrc = mod.run.toString()

  const preChecks = buildPreconditionChecks(meta.preconditions)
  const argsJson = JSON.stringify(args || {})

  // Page selection: when attached to a user's real browser via CDP, playwright-cli's
  // default `page` is an arbitrary tab — possibly a pinned/bookmarked one the user
  // does NOT want hijacked. We pick a target in this order:
  //   1. If meta.preconditions.url exists AND a sibling tab matches → use the
  //      MOST RECENT matching tab (findLast). Recent tabs are more likely to be
  //      what the user just opened or what an earlier snippet just used; older
  //      matches may be stashed in workspaces or archived tabs the user can't see.
  //   2. Else → open a fresh tab via context.newPage(). Better to add a tab than
  //      stomp on something the user had open.
  // Either way, bringToFront() surfaces the picked tab.
  const urlRe = meta.preconditions && meta.preconditions.url
  const pageSelect = urlRe
    ? `const __wrCtx = page.context();
const __wrTargetRe = ${regexLiteral(meta.preconditions.url)};
const __wrTarget = __wrCtx.pages().findLast(p => __wrTargetRe.test(p.url()));
const __wrOpenedFresh = !__wrTarget;
page = __wrTarget || await __wrCtx.newPage();`
    : `const __wrOpenedFresh = true;
page = await page.context().newPage();`

  // Assemble the run-code argument. The whole `run` function is embedded as a
  // callable rather than its body extracted — this sidesteps brace-matching
  // ambiguity around destructured parameters with defaults (e.g. `run(page,
  // { rank = 1 } = {})`).
  const code = `async page => {
${pageSelect}
await page.bringToFront().catch(() => {});
${preChecks}
const args = ${argsJson};
const __wrRun = ${runSrc};
return await __wrRun(page, args);
}`

  const sessionId = process.env.FORGE_SESSION_ID || null
  const tierDir = join(ROOT, found.tier)

  const r = spawnSync('playwright-cli', [`-s=${SESSION}`, 'run-code', code], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })

  // playwright-cli run-code exits 0 even when the wrapped function throws —
  // it emits `### Error\n<message>` to stdout instead of returning non-zero.
  // We need to detect both: a non-zero status (rare; usually means playwright-cli
  // itself blew up) AND the presence of an `### Error` block in stdout (the
  // common failure path — the snippet body threw).
  const stderr = r.stderr || ''
  const stdout = r.stdout || ''
  const errMatch = stdout.match(/### Error\n([\s\S]*?)(?:\n### Ran Playwright code|$)/)
  const runFailed = r.status !== 0 || errMatch !== null

  if (runFailed) {
    const errText = errMatch
      ? errMatch[1].trim()
      : (stderr + stdout).trim()
    const isPrecondition = /precondition:/i.test(errText)
    appendHistory(tierDir, name, {
      event: isPrecondition ? 'precondition-failed' : 'invoke-failed',
      args: args || {},
      error: errText.slice(-2000),
      sessionId,
    })
    process.stdout.write(JSON.stringify({
      ok: false,
      stage: isPrecondition ? 'precondition' : 'run',
      error: errText,
    }) + '\n')
    process.exit(0) // not a registry error; the snippet failed cleanly
  }

  // Bump stats — successful invocations only.
  const stats = readStats()
  const entry = stats[name] || { tier: found.tier, useCount: 0, lastUsed: null, createdAt: nowIso() }
  entry.useCount += 1
  entry.lastUsed = nowIso()
  entry.tier = found.tier

  appendHistory(tierDir, name, {
    event: 'invoked',
    args: args || {},
    useCount: entry.useCount,
    sessionId,
  })

  // Auto-promote based on useCount thresholds. Mutates `entry.tier` and moves
  // files; the subsequent writeStats picks up the new tier value.
  const promotion = maybePromote(name, entry, sessionId)
  stats[name] = entry
  writeStats(stats)

  // Parse playwright-cli's stdout to extract just the snippet's return value.
  // Format is:
  //   ### Result
  //   <json or text value>
  //   ### Ran Playwright code
  //   ```js
  //   <code we just sent — already in our repo, pure noise>
  //   ```
  // Playwright-cli OMITS the entire "### Result" block when the snippet's
  // return value is undefined. extracted.hadResult disambiguates that case from
  // a snippet that explicitly returned null.
  const extracted = extractResult(r.stdout || '')

  // Optional debug dump — set FORGE_DEBUG=1 to capture raw stdout/stderr to disk.
  // Files land in $FORGE_ROOT/debug/ so they don't clutter the data root.
  if (process.env.FORGE_DEBUG) {
    const dbgDir = join(ROOT, 'debug')
    try { mkdirSync(dbgDir, { recursive: true }) } catch {}
    const ts = nowIso().replace(/[:.]/g, '-')
    try {
      writeFileSync(join(dbgDir, `${ts}-${name}.stdout.txt`), r.stdout || '', 'utf8')
      writeFileSync(join(dbgDir, `${ts}-${name}.stderr.txt`), r.stderr || '', 'utf8')
    } catch {}
  }

  // If we promoted, also regenerate the index so the new tier shows up correctly.
  if (promotion) regenerateIndex()

  // Record the successful invocation in this session's transcript, used by
  // /forge spec to assemble a Playwright spec from a slice of session activity.
  appendTranscript({
    event: 'invoked',
    snippet: name,
    tier: entry.tier,
    args: args || {},
    result: extracted.value,
    hadResult: extracted.hadResult,
  })

  process.stdout.write(JSON.stringify({
    ok: true,
    tier: entry.tier,
    useCount: entry.useCount,
    promoted: promotion,
    hadResult: extracted.hadResult,
    result: extracted.value,
  }) + '\n')
}

function extractResult(stdout) {
  // Match the "### Result\n...\n### Ran Playwright code" block; the value is whatever's
  // between those headers. If there's no "Ran Playwright code" trailer, take everything
  // after "### Result" to EOF.
  //
  // Returns:
  //   { hadResult: true,  value: <parsed value> } — snippet explicitly returned something
  //   { hadResult: true,  value: null }            — snippet returned null
  //   { hadResult: false, value: null }            — snippet returned undefined (no result block)
  const match = stdout.match(/### Result\n([\s\S]*?)(?:\n### Ran Playwright code|$)/)
  if (!match) return { hadResult: false, value: null }
  const raw = match[1].trim()
  if (!raw) return { hadResult: true, value: null }
  try { return { hadResult: true, value: JSON.parse(raw) } } catch { return { hadResult: true, value: raw } }
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  switch (cmd) {
    case 'list': {
      const snippets = listSnippets()
      const stats = readStats()
      const enriched = snippets.map(s => ({ ...s, stats: stats[s.name] || null }))
      process.stdout.write(JSON.stringify(enriched, null, 2) + '\n')
      return
    }
    case 'show': {
      const name = rest[0]
      if (!name) die('show requires a snippet name', 2)
      const found = findSnippet(name)
      if (!found) die(`snippet not found: ${name}`, 1)
      const stats = readStats()
      const src = readFileSync(found.path, 'utf8')
      process.stdout.write(JSON.stringify({
        ...found,
        stats: stats[name] || null,
        source: src,
      }, null, 2) + '\n')
      return
    }
    case 'reindex': {
      const { count, path } = regenerateIndex()
      process.stdout.write(JSON.stringify({ ok: true, count, path }) + '\n')
      return
    }
    case 'invoke': {
      const name = rest[0]
      if (!name) die('invoke requires a snippet name', 2)
      let args = {}
      if (rest[1]) {
        try { args = JSON.parse(rest[1]) } catch { die('invoke arg must be valid JSON', 2) }
      }
      await invokeSnippet(name, args)
      return
    }
    case 'record-authoring': {
      const name = rest[0]
      if (!name) die('record-authoring requires a snippet name', 2)
      let result = null
      if (rest[1]) {
        try { result = JSON.parse(rest[1]) } catch { die('record-authoring result must be valid JSON', 2) }
      }
      recordAuthoring(name, result)
      return
    }
    case 'delete': {
      const name = rest[0]
      if (!name) die('delete requires a snippet name', 2)
      const force = rest.includes('--force')
      deleteSnippet(name, force)
      return
    }
    case 'prune': {
      const dryRun = rest.includes('--dry-run')
      const actions = pruneStale(dryRun)
      process.stdout.write(JSON.stringify({ ok: true, dryRun, ...actions }, null, 2) + '\n')
      return
    }
    case 'drive': {
      await driveAction(rest)
      return
    }
    case 'capture': {
      const metaJson = rest[0]
      if (!metaJson) die('capture requires a JSON meta arg', 2)
      const force = rest.includes('--force')
      recordCapture(metaJson, force)
      return
    }
    case 'discard': {
      const reason = rest[0]
      if (!reason) die('discard requires a reason string', 2)
      recordDiscard(reason)
      return
    }
    case 'collate': {
      const sessionId = rest[0] || process.env.CLAUDE_CODE_SESSION_ID
      if (!sessionId) die('collate: pass a session-id or set CLAUDE_CODE_SESSION_ID', 2)
      const result = collateSession(sessionId)
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      return
    }
    default:
      die('usage: forge-registry.mjs <list|show|reindex|invoke|record-authoring|delete|prune|drive|capture|discard|collate> [args...]', 2)
  }
}

main().catch(err => {
  console.error('forge-registry: unexpected error:', err && err.stack || err)
  process.exit(4)
})
