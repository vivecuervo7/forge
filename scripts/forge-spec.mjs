#!/usr/bin/env node
// forge-spec.mjs — run a previously-written Playwright spec.
//
// Spec authoring lives in the `forge:spec-writer` agent, which reads a session
// transcript and writes `<label>.spec.ts` directly. This script is the runner
// only — it spawns `npx playwright test <spec>` inside the bundled workspace
// at $FORGE_ROOT/runner/ so generated specs can execute without any host
// project setup.
//
// Subcommands:
//   run [label] [extra-playwright-args...]
//     If <label> is omitted, runs the most-recently-modified .spec.ts in
//     $FORGE_ROOT/specs/. Flag-shaped args (--ui, --headed, --debug, etc.)
//     forward to `playwright test`.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

const ROOT = process.env.FORGE_ROOT || join(homedir(), '.claude/.vive-claude/forge')

function die(msg, code = 1) {
  console.error('forge-spec:', msg)
  process.exit(code)
}

async function runSpec(label, extraArgs = []) {
  const specsDir = join(ROOT, 'specs')
  const runnerDir = join(ROOT, 'runner')

  if (!existsSync(runnerDir) || !existsSync(join(runnerDir, 'node_modules', '@playwright', 'test'))) {
    die(`runner workspace not bootstrapped — run forge-bootstrap.sh first (expected at ${runnerDir})`, 1)
  }
  if (!existsSync(specsDir)) die(`no specs directory at ${specsDir}; nothing to run`, 1)

  // Resolve which spec file to run.
  let specPath
  if (label) {
    const candidates = [
      join(specsDir, `${label}.spec.ts`),
      join(specsDir, label.endsWith('.spec.ts') ? label : `${label}.spec.ts`),
    ]
    specPath = candidates.find(p => existsSync(p))
    if (!specPath) die(`no spec found for label '${label}' in ${specsDir}`, 1)
  } else {
    const files = readdirSync(specsDir).filter(f => f.endsWith('.spec.ts'))
    if (files.length === 0) die(`no specs in ${specsDir}; have the spec-writer agent produce one first`, 1)
    const stats = files.map(f => ({ f, mtime: statSync(join(specsDir, f)).mtimeMs }))
    stats.sort((a, b) => b.mtime - a.mtime)
    specPath = join(specsDir, stats[0].f)
  }

  process.stderr.write(`forge-spec: running ${specPath}${extraArgs.length ? ' (extra args: ' + extraArgs.join(' ') + ')' : ''}\n`)

  const args = ['playwright', 'test', specPath, ...extraArgs]
  await new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: runnerDir,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(Object.assign(new Error(`playwright test exited with code ${code}`), { code }))
    })
    child.on('error', reject)
  }).catch(err => {
    process.exit(err.code || 1)
  })
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  switch (cmd) {
    case 'run': {
      // First non-flag positional arg is the label; everything else forwards.
      let label = null
      const extraArgs = []
      for (const arg of rest) {
        if (arg.startsWith('-') || label !== null) extraArgs.push(arg)
        else label = arg
      }
      await runSpec(label, extraArgs)
      return
    }
    default:
      die('usage: forge-spec.mjs run [label] [extra-playwright-args...]', 2)
  }
}

main().catch(err => {
  console.error('forge-spec: unexpected error:', err && err.stack || err)
  process.exit(4)
})
