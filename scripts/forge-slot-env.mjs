// forge-slot-env.mjs — load a slot's per-persona env into a plain dict.
//
// Used by the forge pool wrapper scripts (forge-pool-run-spec.mjs,
// forge-pool-run-code.mjs, forge-pool-invoke-snippet.mjs) so the agent-team
// architecture doesn't require direnv on consumers' machines. Forge speaks
// dotenv natively for slot-scoped env; users can layer their own direnv
// (1Password integration, dev-machine specifics, etc.) on top — by default
// process.env wins, so anything in the user's shell environment when the
// wrapper starts takes precedence over slot values.
//
// Format expected: KEY=VALUE per line, # comments, blank lines OK. Quoting
// supported in the standard dotenv way (single or double quoted values are
// unwrapped). This is a deliberately tiny parser — for richer behavior
// (variable expansion, multi-line, etc.) projects should pass values through
// their root .env (loaded by the playwright config via the dotenv package)
// instead.
//
// Backward compatibility: if <slot>/.env doesn't exist but <slot>/.envrc
// does (older direnv-based slots), this helper parses the .envrc's
// `export KEY=VALUE` lines on a best-effort basis. New slots are minted
// with .env via the provisioning recipe in hints/forge.md.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function parseDotenv(content) {
  const env = {}
  for (let line of content.split('\n')) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    // Strip optional `export ` prefix for back-compat with .envrc files.
    if (line.startsWith('export ')) line = line.slice(7).trimStart()
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Unwrap quoted values.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Strip trailing inline comments for unquoted values only.
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const hashIdx = value.indexOf(' #')
      if (hashIdx > 0) value = value.slice(0, hashIdx).trimEnd()
    }
    if (key) env[key] = value
  }
  return env
}

/**
 * Read a slot's per-persona env from <slot>/.env (preferred) or <slot>/.envrc
 * (back-compat). Returns a plain key→value object. Empty object if slotDir
 * is falsy or neither file exists.
 */
export function loadSlotEnv(slotDir) {
  if (!slotDir) return {}
  const envPath = join(slotDir, '.env')
  if (existsSync(envPath)) {
    return parseDotenv(readFileSync(envPath, 'utf8'))
  }
  const envrcPath = join(slotDir, '.envrc')
  if (existsSync(envrcPath)) {
    return parseDotenv(readFileSync(envrcPath, 'utf8'))
  }
  return {}
}

/**
 * Compose a spawn-options env that gives process.env (the wrapper's own env,
 * which already contains anything the user's shell direnv loaded) precedence
 * over slot values. Use as `spawn(cmd, args, { env: composedEnv(slotEnv), ... })`.
 */
export function composedEnv(slotEnv) {
  return { ...slotEnv, ...process.env }
}
