#!/usr/bin/env node
// guard-playwright-cli.test.mjs — should-deny / should-allow matrix for the
// guard hook. Spawns the hook exactly as the harness does (PreToolUse JSON
// on stdin), so it exercises the real contract: deny JSON on stdout for an
// invocation, silence for a mention.
//
// Run: node hooks/guard-playwright-cli.test.mjs
// Exit 0 = all cases pass; 1 = failures (each printed).

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'guard-playwright-cli.mjs')

const PW = 'playwright' + '-cli' // avoid the literal token in transcripts of runs of this file

// Commands that actually invoke the binary — the hook must DENY.
const shouldDeny = [
  `${PW} open about:blank`,
  `${PW} -s=ft-1 click e3`,
  `npx ${PW} open`,
  `npx --yes ${PW} open`,
  `npx -p ${PW} ${PW} open`,
  `direnv exec . ${PW} open`,
  `FOO=bar ${PW} open`,
  `FOO=bar BAZ=qux ${PW} open`,
  `env FOO=bar ${PW} open`,
  `time ${PW} open`,
  `nohup ${PW} open`,
  `sudo ${PW} open`,
  `echo e3 | xargs ${PW} click`,
  `/usr/local/bin/${PW} open`,
  `./node_modules/.bin/${PW} open`,
  `cd /tmp && ${PW} open`,
  `true; ${PW} open`,
  `${PW} open &`,
  `$(${PW} session-list)`,
  `(${PW} open)`,
  `ls\n${PW} open`,
  `cat <<EOF\nharmless mention: ${PW}\nEOF\n${PW} open`, // invocation AFTER a heredoc still caught
]

// Commands that merely mention the token — the hook must ALLOW.
const shouldAllow = [
  `grep -rn ${PW} README.md`,
  `grep -c "${PW}:\\*" skills/forge/SKILL.md`,
  `rg '${PW}' -l`,
  `git log --grep ${PW}`,
  `git commit -m "route through forge-pw, not ${PW}"`,
  `echo "${PW} is blocked"`,
  `echo '${PW} is blocked'`,
  `cat docs/notes.md | grep ${PW}`,
  `sed -i '' 's/${PW}/forge-pw/g' notes.md`,
  `git commit -m "$(cat <<'EOF'\nfix: steer agents away from ${PW}\n\nThe ${PW} binary leaks argv secrets.\nEOF\n)"`,
  `cat <<EOF > notes.md\nuse forge-pw instead of ${PW}\nEOF`,
  `node scripts/forge-pw.mjs -s=ft-1 open --headed about:blank`, // no token at all
  `ls -la`, // no token at all
  // Paths CONTAINING the token (the .${PW}/ artifact dir) are mentions, not
  // invocations — a driver reading its own console logs must not be blocked.
  `tail -50 .${PW}/console-2026-07-05T21-52-21.log`,
  `grep -c error .${PW}/console-2026-07-05.log`,
  `wc -l .${PW}/console-2026-07-05.log`,
  `find . -name 'console-*.log' -path '*.${PW}*'`,
  `python3 parse_log.py .${PW}/console-2026-07-05.log`,
  `sed -n 1,30p hooks/guard-${PW}.test.mjs`,
]

function runHook(command) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } })
  const res = spawnSync('node', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, FORGE_ALLOW_RAW_PW: '' }, // neutralize any ambient escape hatch
  })
  if (res.status !== 0) return { denied: false, error: `hook exited ${res.status}: ${res.stderr}` }
  const denied = res.stdout.includes('"permissionDecision":"deny"')
  return { denied }
}

let failures = 0
const report = (ok, expectation, command) => {
  if (ok) return
  failures++
  console.error(`FAIL (expected ${expectation}): ${JSON.stringify(command)}`)
}

for (const cmd of shouldDeny) {
  const { denied, error } = runHook(cmd)
  if (error) {
    failures++
    console.error(`FAIL (hook error): ${JSON.stringify(cmd)} — ${error}`)
    continue
  }
  report(denied, 'deny', cmd)
}

for (const cmd of shouldAllow) {
  const { denied, error } = runHook(cmd)
  if (error) {
    failures++
    console.error(`FAIL (hook error): ${JSON.stringify(cmd)} — ${error}`)
    continue
  }
  report(!denied, 'allow', cmd)
}

// Escape hatch: an invocation must pass when FORGE_ALLOW_RAW_PW=1.
{
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: `${PW} open` } }),
    encoding: 'utf8',
    env: { ...process.env, FORGE_ALLOW_RAW_PW: '1' },
  })
  report(!res.stdout.includes('deny'), 'allow (escape hatch)', `${PW} open  [FORGE_ALLOW_RAW_PW=1]`)
}

// Non-Bash tools are never touched.
{
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: `/x/${PW}.md` } }),
    encoding: 'utf8',
  })
  report(!res.stdout.includes('deny'), 'allow (non-Bash tool)', 'Read payload')
}

const total = shouldDeny.length + shouldAllow.length + 2
if (failures === 0) {
  console.log(`guard-playwright-cli.test: all ${total} cases pass`)
} else {
  console.error(`guard-playwright-cli.test: ${failures}/${total} cases FAILED`)
  process.exit(1)
}
