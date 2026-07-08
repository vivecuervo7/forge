// common — helpers shared across the forge scripts.
//
// Single source of truth for:
//   - locating a project's forge/ root (walk-up + explicit-arg resolution)
//   - extracting and evaluating a snippet's `export const meta = {...}` block
//   - recognising ticket-key-shaped snippet names
//
// Each script previously carried its own copy of these, and the copies had
// begun to diverge (one walk accepted any ancestor with a bare hints/ dir;
// the ticket-key check was hardcoded to one project's prefix).

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// A directory "looks like" a forge root when it carries the hints/ marker.
// Used to sanity-check derived paths (e.g. dirname(dirname(specPath)))
// before doing anything destructive-adjacent like installing runner deps.
export function looksLikeForgeRoot(dir) {
  return existsSync(join(dir, 'hints'))
}

// Walk up from `start` looking for a directory that CONTAINS forge/hints/ —
// same pattern as git looking for .git/. The directory must be named forge/;
// a bare hints/ dir in an unrelated ancestor never matches. Works from inside
// forge/ too: the walk reaches the project root and finds <root>/forge/hints
// from there. Returns the absolute path to forge/, or null.
export function findForgeRoot(start) {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, 'forge', 'hints'))) return join(dir, 'forge')
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// Resolve an explicitly-passed root argument: accepts either the forge/
// directory itself or its parent (the project root). Returns the forge dir,
// or null when neither shape matches.
export function resolveForgeRootArg(path) {
  const resolved = resolve(path)
  if (looksLikeForgeRoot(resolved)) return resolved
  if (existsSync(join(resolved, 'forge', 'hints'))) return join(resolved, 'forge')
  return null
}

// Ticket-key-shaped snippet names (`proj-123-checkout-flow`, `proj-123`) date
// fast and hide intent — the curator names by <verb>-<noun>. Returns the
// matched key (e.g. "proj-123") or null. The digits must end the name or be
// followed by another segment, so digit-leading words inside a name
// (`fill-2fa-code`) don't false-positive.
export function ticketKeyPrefix(name) {
  const m = /^([a-z][a-z0-9]*-\d+)(?:-|$)/i.exec(name)
  return m ? m[1] : null
}

// Extract the source text of `export const meta = { ... }` from a snippet.
// Balanced-brace scan from the first `{`, aware of strings and comments, so
// nested object/array literals inside meta are handled. Returns the `{...}`
// source (braces included) or null when no meta block is found.
export function extractMetaSource(src) {
  const declMatch = src.match(/export\s+const\s+meta\s*=\s*/m)
  if (!declMatch) return null

  const startIdx = declMatch.index + declMatch[0].length
  if (src[startIdx] !== '{') return null

  let depth = 0
  let inString = null  // null | "'" | '"' | '`'
  let inLineComment = false
  let inBlockComment = false
  let escape = false

  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return src.slice(startIdx, i + 1)
      }
    }
  }
  return null
}

// Evaluate a meta literal in a bare Function sandbox. Wrapped in parens so
// the `{...}` parses as an expression, not a block. Returns { meta, error }:
// meta is null (and error carries the message) when evaluation failed.
export function evalMeta(metaSrc) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${metaSrc});`)
    return { meta: fn(), error: null }
  } catch (e) {
    return { meta: null, error: e.message }
  }
}
