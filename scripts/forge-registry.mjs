#!/usr/bin/env node
// forge-registry.mjs — the snippet registry.
//
// This script is the file-IO + browser-bridge layer. It does NOT make judgment
// calls about chunking, naming, or snippet authoring — that lives in the
// `forge:author` agent which reads the session transcript and writes snippet
// files via the Write tool directly. The script's job is to expose dumb,
// well-defined operations the driver agent and author agent can compose.
//
// Subcommands:
//   list                      List every snippet across tiers (JSON to stdout)
//   show <name>               Print one snippet's metadata + path
//   reindex                   Regenerate ~/.claude/.vive-claude/forge/INDEX.md
//                             (Called by the author agent after writing new
//                             snippet files to scratch/.)
//   invoke <name> [json-args] Run the snippet against the 'forge' playwright-cli session
//                             (precondition check + run + stats bump + history + auto-promote).
//                             Used by the driver agent for cheap reuse of existing patterns.
//   delete <name> [--force]   Remove the snippet file, its history.jsonl, and its stats entry;
//                             regenerate INDEX.md. Refuses on library/ and staged/ without --force.
//   prune [--dry-run]         Apply TTL lifecycle: prune unused scratch (default 7d), demote
//                             unused staged → scratch (default 60d), report stale library
//                             entries (default 90d, never auto-deleted). --dry-run lists what
//                             would happen without applying.
//   drive <playwright-cli args...>
//                             Run `playwright-cli -s=forge <args>` and record the equivalent
//                             Playwright code as a `drove` event in the session transcript.
//                             Used by the driver agent for every browser action it takes.
//                             Read-only commands (snapshot, tab-list, url) are passed through
//                             without recording.
//   note '<text>'             Append a `note` event to the session transcript with free-text
//                             content. Used by the driver agent to leave annotations the
//                             author agent can read as hints when deciding what to capture.
//                             Notes are optional — author works without them by inferring
//                             from event shape alone, but they're cheap insurance for
//                             ambiguous chunks.
//
// Tier promotion:
//   useCount >= STAGE_AT   (default 2) → promote to staged
//   useCount >= LIBRARY_AT (default 3) → promote to library
//   Promotion runs automatically after every successful invoke.
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

// Append a free-text `note` event to the session transcript. The driver agent
// uses this to leave annotations the author agent can read when deciding what
// to capture as snippets — "got HN title", "wikipedia rejected colon-title,
// retrying", "translation extraction returned empty, trying URL-trick".
//
// Notes are optional. The author works without them by inferring intent from
// event shape (which goto navigated where, which run-code returned what value).
// But notes are cheap insurance: when a chunk's intent is ambiguous from
// actions alone, the driver's annotation makes the author's job easier.
function recordNote(text) {
  if (typeof text !== 'string' || !text.trim()) {
    die('note requires a non-empty text string', 2)
  }
  appendTranscript({ event: 'note', text: text.trim() })
  process.stdout.write(JSON.stringify({ ok: true, text: text.trim() }) + '\n')
}

// Run `playwright-cli -s=forge <args>` and record the equivalent Playwright code
// to the session transcript, so the spec-generation pipeline can capture inline
// driving as part of the spec. Read-only commands that emit no `### Ran Playwright
// code` block (snapshot, tab-list, url) are silently passed through without
// recording — they don't contribute to a reproducible test.
async function driveAction(args) {
  if (!args || args.length === 0) die('drive: pass playwright-cli args', 2)

  // Parse `--env KEY` flags out of the args list. These inject the named env
  // vars (resolved from this process's env, where direnv has loaded them at
  // the shell layer) into the run-code sandbox as `process.env.<KEY>` so the
  // user's code can reference them naturally. The literal values never reach
  // the transcript — only the original code is recorded.
  const envKeys = []
  const cleanArgs = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      envKeys.push(args[++i])
    } else {
      cleanArgs.push(args[i])
    }
  }

  let originalCode = null
  if (envKeys.length > 0) {
    if (cleanArgs[0] !== 'run-code') {
      die('drive --env is only valid with run-code', 2)
    }
    if (cleanArgs.length < 2) {
      die('drive run-code --env requires the code as the next positional arg', 2)
    }
    const envObj = {}
    for (const key of envKeys) {
      if (process.env[key] === undefined) {
        die(`drive --env ${key}: env var not set in this process — wrap your invocation with \`direnv exec ...\` if it lives in a direnv file`, 2)
      }
      envObj[key] = process.env[key]
    }
    // Wrap the user's code so `process.env.X` resolves to the injected literal
    // inside playwright-cli's run-code sandbox (which doesn't expose Node's
    // real `process`). The shadowed `process` only carries `env`; everything
    // else on real `process` is still unavailable in run-code — that's fine,
    // run-code doesn't have access to it anyway.
    originalCode = cleanArgs[1]
    cleanArgs[1] = `async page => { const process = { env: ${JSON.stringify(envObj)} }; return await (${originalCode})(page); }`
  }

  ensureSession()
  const r = spawnSync('playwright-cli', [`-s=${SESSION}`, ...cleanArgs], {
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
  let code = codeMatch ? codeMatch[1].trim() : null
  // When env injection was active, playwright-cli echoes the WRAPPED code
  // (with resolved literals). Replace with the user's original code so the
  // transcript stays free of secret values and uses `process.env.X` refs that
  // work natively when later inlined into a Node-side snippet or spec.
  if (originalCode !== null) {
    code = originalCode
  }

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
      command: cleanArgs[0],
      code,
      result,
      ...(envKeys.length > 0 ? { envKeys } : {}),
    })
  }

  // Forward the playwright-cli output to stdout so the caller sees what happened.
  process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  process.exit(r.status || 0)
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

  // Env injection for snippets whose body uses `process.env.X`.
  // playwright-cli's run-code sandbox doesn't expose Node's real `process`,
  // so without this shim the snippet's process.env references resolve to
  // undefined (the same issue that drive --env solves for ad-hoc run-code).
  // Snippets opt in by declaring `envKeys: [...]` in meta; the runner resolves
  // those values at the Node layer (where direnv-loaded env is visible) and
  // injects a process shim into the wrapper code.
  let processShim = ''
  if (Array.isArray(meta.envKeys) && meta.envKeys.length > 0) {
    const envObj = {}
    for (const key of meta.envKeys) {
      if (process.env[key] === undefined) {
        die(`snippet "${name}" declares envKeys: [${meta.envKeys.map(k => `"${k}"`).join(', ')}] but "${key}" is not set in this process — wrap the invocation with \`direnv exec ...\` if the var lives in a direnv file`, 2)
      }
      envObj[key] = process.env[key]
    }
    processShim = `const process = { env: ${JSON.stringify(envObj)} };\n`
  }

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
${processShim}${pageSelect}
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
    case 'note': {
      const text = rest[0]
      if (!text) die('note requires a text string', 2)
      recordNote(text)
      return
    }
    default:
      die('usage: forge-registry.mjs <list|show|reindex|invoke|delete|prune|drive|note> [args...]', 2)
  }
}

main().catch(err => {
  console.error('forge-registry: unexpected error:', err && err.stack || err)
  process.exit(4)
})
