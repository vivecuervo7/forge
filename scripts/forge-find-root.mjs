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

import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const start = process.argv[2] ?? process.cwd()

try {
  if (!statSync(start).isDirectory()) throw new Error()
} catch {
  console.error(`forge-find-root: starting directory does not exist: ${start}`)
  process.exit(2)
}

let dir = resolve(start)
while (true) {
  if (existsSync(join(dir, 'forge', 'hints'))) {
    console.log(join(dir, 'forge'))
    process.exit(0)
  }
  const parent = dirname(dir)
  if (parent === dir) break  // reached fs root
  dir = parent
}

console.error(`forge-find-root: no forge/ directory found in ${start} or any parent.`)
console.error(`  Run /forge init in the project root to scaffold one.`)
process.exit(1)
