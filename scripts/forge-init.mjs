#!/usr/bin/env node
// forge-init.mjs — scaffold the forge/ project convention into a directory.
//
// Creates forge/ with the canonical layout: a gitignored data root, a hints/
// directory for project-specific knowledge, a fallback Playwright config,
// and a forge-level .env. Template content lives at `templates/init/` and
// is copied verbatim into the target on missing files.
//
// Idempotent: existing files are preserved. Re-running fills in anything
// missing without overwriting customizations.
//
// Usage:
//   forge-init.mjs [target-dir]
//
// Defaults to PWD when no arg given.

import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PLUGIN_ROOT = dirname(__dirname)
const TEMPLATES = join(PLUGIN_ROOT, 'templates', 'init')

if (!existsSync(TEMPLATES) || !statSync(TEMPLATES).isDirectory()) {
  console.error(`forge-init: missing templates directory at ${TEMPLATES}`)
  process.exit(2)
}

const targetDir = resolve(process.argv[2] ?? process.cwd())

if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(`forge-init: target directory does not exist: ${targetDir}`)
  process.exit(1)
}

const forgeDir = join(targetDir, 'forge')
const hintsDir = join(forgeDir, 'hints')

mkdirSync(forgeDir, { recursive: true })
mkdirSync(hintsDir, { recursive: true })

const created = []
const skipped = []

// scaffold(templateName, destRelativeToForgeDir)
function scaffold(template, destRel) {
  const src = join(TEMPLATES, template)
  const dest = join(forgeDir, destRel)

  if (!existsSync(src)) {
    console.error(`forge-init: template missing: ${src}`)
    process.exit(2)
  }

  if (existsSync(dest)) {
    skipped.push(`forge/${destRel}`)
  } else {
    copyFileSync(src, dest)
    created.push(`forge/${destRel}`)
  }
}

// Templates use dot-less names so they're visible in the templates dir;
// scaffold them under their dotted destination names where appropriate.
scaffold('gitignore',            '.gitignore')
scaffold('README.md',            'README.md')
scaffold('hints-README.md',      'hints/README.md')
scaffold('playwright.config.ts', 'playwright.config.ts')
scaffold('env',                  '.env')

// Report
console.log(`forge-init: scaffolded ${forgeDir}`)
if (created.length > 0) {
  console.log('  Created:')
  for (const f of created) console.log(`    + ${f}`)
}
if (skipped.length > 0) {
  console.log('  Preserved (already present):')
  for (const f of skipped) console.log(`    = ${f}`)
}

// Pre-install runner dependencies into <forgeDir>/.runner if the project
// doesn't already own playwright. Non-fatal — the install retries lazily
// on first --spec / first invocation if it fails here.
const runnerScript = join(__dirname, 'forge-ensure-runner.mjs')
if (existsSync(runnerScript)) {
  const result = spawnSync('node', [runnerScript, forgeDir], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.log('forge-init: runner pre-install failed (non-fatal — will retry on first --spec / invocation).')
  }
}

console.log('')
console.log(`Next: author hint files in ${hintsDir}/ to describe your project's`)
console.log(`env contract, provisioning recipe, and any project-specific conventions.`)
console.log(`See ${hintsDir}/README.md for guidance — including a starter prompt`)
console.log(`for AI-assisted hint authoring.`)
