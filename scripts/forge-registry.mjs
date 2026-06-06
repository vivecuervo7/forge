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

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, appendFileSync, renameSync, unlinkSync } from 'node:fs'
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
function buildPreconditionChecks(preconditions) {
  if (!preconditions) return ''
  const checks = []

  if (preconditions.url) {
    checks.push(`{
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
page = __wrTarget || await __wrCtx.newPage();`
    : `page = await page.context().newPage();`

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

  if (r.status !== 0) {
    const errText = ((r.stderr || '') + (r.stdout || '')).trim()
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
  // We surface only the result. If parsing fails, fall back to a truncated raw
  // tail so the caller can still see something.
  const result = extractResult(r.stdout || '')

  // If we promoted, also regenerate the index so the new tier shows up correctly.
  if (promotion) regenerateIndex()

  process.stdout.write(JSON.stringify({
    ok: true,
    tier: entry.tier,
    useCount: entry.useCount,
    promoted: promotion,
    result,
  }) + '\n')
}

function extractResult(stdout) {
  // Match the "### Result\n...\n### Ran Playwright code" block; the value is whatever's
  // between those headers. If there's no "Ran Playwright code" trailer, take everything
  // after "### Result" to EOF.
  const match = stdout.match(/### Result\n([\s\S]*?)(?:\n### Ran Playwright code|$)/)
  if (!match) return null
  const raw = match[1].trim()
  if (!raw) return null
  // Try to parse as JSON for structured output (objects, arrays, numbers, booleans).
  // String values from JSON.stringify in the snippet come quoted; non-JSON values
  // (bare text returned by an evaluate, or undefined → empty) flow through as-is.
  try { return JSON.parse(raw) } catch { return raw }
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
    default:
      die('usage: forge-registry.mjs <list|show|reindex|invoke|record-authoring|delete|prune> [args...]', 2)
  }
}

main().catch(err => {
  console.error('forge-registry: unexpected error:', err && err.stack || err)
  process.exit(4)
})
