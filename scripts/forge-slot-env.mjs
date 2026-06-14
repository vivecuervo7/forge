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
// Parsing is delegated to the `dotenv` package (installed in <forge>/.runner/).
// Standard dotenv format: KEY=VALUE per line, # comments, single/double
// quotes unwrap. Variable expansion is NOT performed (we use dotenv.parse,
// not dotenv-expand) — keeps values literal and prevents .env values from
// referencing each other in surprising ways.
//
// Backward compatibility: if <slot>/.env doesn't exist but <slot>/.envrc
// does (older direnv-based slots), the leading `export ` prefix is stripped
// on the fly so dotenv.parse can read it.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureRunnerDeps, loadFromRunner } from './forge-ensure-runner.mjs'

/**
 * Read a slot's per-persona env from <slot>/.env (preferred) or <slot>/.envrc
 * (back-compat). Returns a plain key→value object. Empty object if slotDir
 * is falsy or neither file exists.
 *
 * Async because it loads `dotenv` from the project's runner install.
 */
export async function loadSlotEnv(slotDir) {
  if (!slotDir) return {}

  const envPath = join(slotDir, '.env')
  const envrcPath = join(slotDir, '.envrc')

  const target = existsSync(envPath) ? envPath
    : existsSync(envrcPath) ? envrcPath
    : null
  if (!target) return {}

  // Derive forgeRoot from slotDir: <forge>/.pool/slot-X → dirname(dirname(slotDir))
  const forgeRoot = dirname(dirname(slotDir))
  ensureRunnerDeps(forgeRoot)
  const dotenv = await loadFromRunner(forgeRoot, 'dotenv')

  // Strip the leading `export ` prefix on each line for .envrc back-compat.
  // dotenv doesn't handle it natively.
  const content = readFileSync(target, 'utf8').replace(/^[ \t]*export[ \t]+/gm, '')
  return dotenv.parse(content)
}

/**
 * Compose a spawn-options env that gives process.env (the wrapper's own env,
 * which already contains anything the user's shell direnv loaded) precedence
 * over slot values. Use as `spawn(cmd, args, { env: composedEnv(slotEnv), ... })`.
 */
export function composedEnv(slotEnv) {
  return { ...slotEnv, ...process.env }
}
