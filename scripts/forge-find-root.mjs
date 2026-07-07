#!/usr/bin/env node
// forge-find-root.mjs — locate the project's forge/ directory.
//
// Walks up from a starting directory (default: PWD) looking for a forge/hints/
// directory. First match wins — same pattern as git looking for .git/. Prints
// the absolute path to forge/ to stdout.
//
// Usage:
//   forge-find-root.mjs                  # from PWD
//   forge-find-root.mjs <starting-dir>   # from a specific dir
//
// Exit codes:
//   0   forge root printed to stdout
//   1   no forge/ found above starting dir
//   2   starting dir doesn't exist or other usage error

import { statSync } from 'node:fs'
import { findForgeRoot } from './forge-common.mjs'

const start = process.argv[2] ?? process.cwd()

try {
  if (!statSync(start).isDirectory()) throw new Error()
} catch {
  console.error(`forge-find-root: starting directory does not exist: ${start}`)
  process.exit(2)
}

const root = findForgeRoot(start)
if (root) {
  console.log(root)
  process.exit(0)
}

console.error(`forge-find-root: no forge/ directory found in ${start} or any parent.`)
console.error(`  Run /forge init in the project root to scaffold one.`)
process.exit(1)
