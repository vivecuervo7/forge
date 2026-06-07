---
name: forge
description: "Invoke a forge snippet by name or natural-language description. Use this slash command (/forge) when you want explicit, cheap invocation of a known snippet without the overhead of the browser-session skill's full discovery flow."
disable-model-invocation: true
user-invocable: true
model: haiku
effort: low
argument-hint: "<snippet-name> [json-args] | <natural-language request>"
allowed-tools: Read, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*)
---

# /forge

Invoke a snippet from the forge registry. This is the **explicit / cheap** path — every `/forge` call re-engages the Haiku model pin (unlike the `browser-session` skill's natural-language entry, where the pin only fires on first invocation per session). Use this when you know what you want and don't need conversational discovery.

For authoring new snippets, repair, or anything that needs multi-turn refinement, use the `browser-session` skill instead (say "use forge to ...").

## Steps

1. Bootstrap silently (idempotent, fast no-op when already initialised):
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-bootstrap.sh > /dev/null
   ```
   Use the emitted `FORGE_ROOT` value throughout (or default to `~/.claude/.vive-claude/forge`).

2. Parse `$ARGUMENTS`. Two modes:

   **Name mode** — first whitespace-separated token matches a known snippet name. Test by checking whether `$FORGE_ROOT/{library,staged,scratch}/<token>.ts` exists (use `ls` or `[ -f ... ]`). If yes:
   - `<name>` is that token.
   - `<args>` is the remainder of `$ARGUMENTS` if non-empty, else `{}`. Pass through verbatim — caller's responsibility to format as JSON.

   **NL mode** — first token doesn't match a known snippet name. Read `$FORGE_ROOT/INDEX.md`. Match the user's description against snippet descriptions (favouring library > staged > scratch on ties). Pick the best fit. Infer args from the description (e.g. "the 2nd story" → `{"rank": 2}`). If no plausible match, report it (see Failure cases below).

3. Invoke:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs invoke <name> '<args-json>'
   ```

4. Report the result. The registry's JSON output contains `result` (or `hadResult: false` for side-effectful snippets that return nothing). Surface the meaningful payload to the user — don't paste raw JSON unless it's useful.

## Failure cases

- **No matching snippet**: report concisely, then suggest the `browser-session` flow:
  ```
  No snippet matches "<their request>". Want me to author one? Say:
    Use forge to <description>
  ```
  Do NOT invoke `forge:snippet-author` from here — authoring is a separate, more expensive flow that belongs in the natural-language path.

- **Invocation returned `ok: false`**: relay the `stage` and `error`. If `stage: "precondition"`, mention the user may need to navigate to the right page first. If `stage: "run"`, suggest the snippet may have drifted and re-authoring might be needed.

- **`$ARGUMENTS` empty**: report the usage hint and list available snippets via `cat $FORGE_ROOT/INDEX.md`.

## What this skill is NOT

- **Not for authoring.** Discovery, multi-turn refinement, and authoring all go through the `browser-session` skill.
- **Not for repair.** A failing snippet means the user should re-run via `browser-session` or wait for the (future) repair agent.
- **Not for managing the registry.** Use the registry's subcommands directly: `forge-registry.mjs list|show|reindex|delete|prune`.
