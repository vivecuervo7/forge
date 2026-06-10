# Debugging forge sub-agent runs

When forge spawns its sub-agents (`forge:driver`, `forge:author`, `forge:spec-writer`), each gets its own full transcript saved to disk. The parent session sees only the agent's final summary — but the entire internal execution (every tool call, every reasoning step, every file read) is recorded separately.

## Where to look

Sub-agent transcripts live at:

```
~/.claude/projects/<encoded-cwd>/<parent-session-id>/subagents/agent-<hash>.jsonl
~/.claude/projects/<encoded-cwd>/<parent-session-id>/subagents/agent-<hash>.meta.json
```

`<encoded-cwd>` is the user's working directory with slashes replaced by dashes (e.g. `-Users-isaac-makerx-ea-nextgen-planner-app`).

The `.meta.json` file declares `agentType` and a short `description`. The `.jsonl` is the full conversation transcript in the same format as a normal Claude Code session — every assistant turn, every tool call, every result.

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

- `forge:driver` invocations of `playwright-cli` via the registry: the playwright-cli session itself doesn't write to the sub-agent transcript — only the driver's *calls* to it. The browser-side log (drove / invoked / note events) lives in the forge session transcript at `$FORGE_ROOT/sessions/<id>.jsonl`, where `<id>` is the parent `CLAUDE_CODE_SESSION_ID`. The per-run `runs/<id>/` directory holds the browser profile + `state.json`, not the transcript.
- Anything the agent decided to `Read` but didn't show in its summary — still recorded in `tool_use_result` blocks within the sub-agent transcript.
