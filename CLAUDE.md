# Debugging forge sub-agent runs

When forge spawns its sub-agents (`forge:driver`, `forge:snippet-author`, `forge:spec-writer`, `forge:spec-verifier`), each gets its own full transcript saved to disk. The parent session sees only the agent's final summary — but the entire internal execution (every tool call, every reasoning step, every file read) is recorded separately.

## Where to look

Sub-agent transcripts live at:

```
~/.claude/projects/<encoded-cwd>/<parent-session-id>/subagents/agent-<hash>.jsonl
~/.claude/projects/<encoded-cwd>/<parent-session-id>/subagents/agent-<hash>.meta.json
```

`<encoded-cwd>` is the user's working directory with slashes replaced by dashes (e.g. `-Users-jane-code-my-app`).

The `.meta.json` file declares `agentType` and a short `description`. The `.jsonl` is the full conversation transcript in the same format as a normal Claude Code session — every assistant turn, every tool call, every result.

## Team-peer transcripts (not under `subagents/`)

Only orchestrator sub-agents spawned via the `Task` tool land under `subagents/`. The team-mesh peers — `forge:driver`, `forge:snippet-author`, `forge:spec-writer`, `forge:spec-verifier` — are full Claude Code sessions in their own right, and their transcripts live as **top-level** session files alongside the parent:

```
~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
```

Each team-peer transcript carries `agentName` and `teamName` fields in its JSONL header, which is how you tell them apart from a normal user session in the same directory.

```bash
# List the agents currently or recently active on a given team
jq -r 'select(.teamName == "<team>") | .agentName' \
  ~/.claude/projects/<encoded-cwd>/*.jsonl 2>/dev/null \
  | sort -u

# Find the most recent team-peer transcript across the project
ls -t ~/.claude/projects/<encoded-cwd>/*.jsonl \
  | xargs -I{} sh -c 'jq -r "select(.teamName) | input_filename" {} 2>/dev/null | head -1'
```

If a debug trail is missing from `subagents/`, check the top level for `teamName`-bearing peers before concluding nothing was logged.

## Practical commands

```bash
# Find the most recently modified sub-agent transcript anywhere
ls -t ~/.claude/projects/*/*/subagents/*.jsonl 2>/dev/null | head -1

# List sub-agents from the most recent parent session that spawned any
ls -t ~/.claude/projects/*/*/subagents/ 2>/dev/null | head

# Pretty-print one transcript for review
jq . <path/to/agent-<hash>.jsonl> | less -R

# See what tools a sub-agent invoked
grep -oE '"name":"[A-Z][A-Za-z]+"' <path> | sort | uniq -c | sort -rn

# Pull just the assistant turns (skip user/tool-result entries)
jq -c 'select(.type == "assistant") | .message.content' <path>
```

## When debugging a forge run that went sideways

1. Note the rough time the user invoked forge.
2. Find the parent session's directory under `~/.claude/projects/<cwd>/`.
3. Open the `subagents/` folder there and read the `.meta.json` files to identify which sub-agent failed (description usually matches the task forge was attempting).
4. Open the matching `.jsonl` and walk through the assistant turns + tool calls to see exactly what the sub-agent did and where it diverged.

## What's *not* captured

- `forge:driver` invocations of `playwright-cli`: the playwright-cli session itself doesn't write to the sub-agent transcript — only the driver's *calls* to it.
- Anything the agent decided to `Read` but didn't show in its summary — still recorded in `tool_use_result` blocks within the sub-agent transcript.
