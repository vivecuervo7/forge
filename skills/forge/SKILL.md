---
name: forge
description: "Perform repeatable user actions in a real browser — delete batches of emails, paste gifs into PRs, navigate multi-step forms, scrape pages, anything you'd rather not click through again. Triggers on 'use forge to ...' phrases AND on `/forge ...` slash invocations. Two entry points: `/forge snippet <name>` for explicit cheap invocation of a known snippet; everything else (slash or natural language) routes through discovery, composition, and authoring delegation as needed."
model: haiku
effort: low
argument-hint: "snippet <name> [json-args] | <description or multi-step request>"
allowed-tools: Read, Skill, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(playwright-cli:*), Bash(curl -sf -m * http://localhost:9222/json/version*)
---

# forge

A browser assistant for repeatable user actions. The primary use case is replacing routine browser drudgery — anything you'd rather not click through yourself again. Snippets are how forge remembers what worked; specs (later) are an optional export for when CI cares.

Forge is a thin wrapper around the `playwright-cli` skill: that skill owns the action vocabulary, forge owns the session lifecycle, the snippet registry, and the spec-generation pipeline. Authoring new snippets is delegated to the `forge:snippet-author` agent (noise quarantine).

If the user is asking about something that *isn't* in a browser, you're in the wrong skill.

## Modes

Look at the user's request:

1. **Direct mode** — request is the slash form `snippet <name> [json-args]` (i.e. `$ARGUMENTS` starts with the verb `snippet`). Skip discovery; invoke the named snippet directly. Cheap muscle-memory path.
2. **NL mode** — anything else. Read INDEX.md, match the request to a snippet (possibly with arg overrides). For multi-step requests, compose snippets in order. If no snippet covers something, delegate to the author agent.

Both modes share the same bootstrap + session-check preamble.

## Preamble (both modes)

Always run the bootstrap once — idempotent, fast no-op on subsequent calls:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-bootstrap.sh
```

Emits `FORGE_ROOT=…`, `FORGE_PROFILE=…`, `FORGE_SESSION=forge`, `PLAYWRIGHT_CLI=…` as `KEY=VALUE` lines. Use throughout.

Before any browser work, ensure the `forge` playwright-cli session is active:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-session.sh --probe-only
```

- Exit 0 → session is established.
- Exit 1 → no session and no CDP browser to attach to. **Ask the user before establishing one** — the side effect is visible:

  > No `forge` session is active and nothing is listening on localhost:9222. I can launch a managed Chrome with a dedicated profile at `~/.claude/.vive-claude/forge/chromium-profile/`. This is a separate browser from your everyday Chrome — fresh cookies, fresh history. OK to proceed?

  On approval: drop the `--probe-only` flag. If the user *was* already browsing in a CDP-enabled Chromium-family browser, the script attaches to it (real cookies, real auth, real tabs — surface that).

## Direct mode

Triggered by `/forge snippet <name> [json-args]`. Just invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs invoke <name> '<json-args>'
```

If `<json-args>` was omitted, use `{}`. Report the result. No INDEX read, no matching, no composition — this path is deliberately bare metal.

## NL mode

### Find a snippet

```bash
cat $FORGE_ROOT/INDEX.md
```

The index is `library` → `staged` → `scratch` → `broken`, with each tier's snippets listed as `` `name` — description ``. Match on description; ignore `broken/` (those need repair before invocation).

**Read `meta.args` and description carefully** — many snippets accept args that cover variations of their default behaviour (e.g. `hn-story-title` with `{rank: 2}` for the 2nd story). If you can fulfil the request with an arg override on an existing snippet, do that.

For richer detail than the index line:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs show <name>
```

### Invoke a snippet

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs invoke <name> '<json-args>'
```

The registry handles preconditions, stats, history, and auto-promotion. Output is one line of JSON:

- `{"ok":true,"tier":"library","useCount":4,"hadResult":true,"result":<value>}` — success. `result` is whatever the snippet returned (parsed as JSON if structured). `hadResult: false` means the snippet ran but returned `undefined` — normal for side-effectful snippets ("done" is the answer). Report what's meaningful to the user.
- `{"ok":false,"stage":"precondition","error":"..."}` — preconditions failed. Don't retry blindly. Surface the reason and ask the user how to proceed (e.g. navigate first, then retry).
- `{"ok":false,"stage":"run","error":"..."}` — the snippet itself threw. The snippet may have drifted under DOM changes; report the error and tell the user.

### Multi-step composition

If the user's request spans multiple snippets (e.g. "get the top HN title and compose an email to alice@x.com with that title as the subject"), chain invocations:

1. Decompose into ordered steps.
2. For each step, identify the snippet (by NL match, or by name if user provided it).
3. Invoke step 1. Capture its `result`.
4. Build step 2's args by combining user-supplied values with fields from step 1's result.
5. Invoke step 2. Continue until done.
6. If any step has no matching snippet, fall back to delegating that step to the author agent (more expensive — note this if it happens unexpectedly).

Example shape:

```
Step 1: hn-first-story-comments {} → result.title = "..."
Step 2: gmail-compose-new {to: "alice@x.com", subject: "<title from step 1>"} → ok
```

Report a tight summary: what each step did and the final outcome. Don't paste raw JSON unless it helps the user.

### Direct browser inspection (no snippet needed)

For one-off "what's open?" / "what's on this page?" / "where am I?" questions where authoring a snippet would be overkill, use playwright-cli's structured commands directly:

```bash
playwright-cli -s=forge tab-list      # URLs and titles of every open tab
playwright-cli -s=forge snapshot      # ARIA snapshot of the current page
playwright-cli -s=forge url           # current URL + title of the active page
```

**Avoid `playwright-cli run-code` from the main session** — it requires an `async page => { ... }` arrow wrapper and is fiddly. If you need arbitrary Playwright code, that's the snippet-author agent's job.

### Delegate authoring when no snippet matches

If the index has nothing relevant (and arg overrides won't cover the request), **spawn the `forge:snippet-author` agent**. The agent quarantines DOM exploration in its own context window so this conversation stays narrow.

Before delegating, confirm the forge session is alive. Then:

```
Agent(subagent_type="forge:snippet-author",
  prompt="Goal: <natural language goal>
Suggested name: <optional kebab-case name>
Args: <optional comma-separated arg names and any user-supplied values>
Context: <optional — current URL, ticket ref, prerequisite state>")
```

The agent returns one of:

- `Authored: <name> → scratch/<name>.ts` followed by `Description:`, `Args:`, `Preconditions:`, `Result:`, and optionally `Confirm:`. **Do NOT re-invoke** — the agent's drive was the first execution. Steps:
  1. Report the `Result:` value to the user.
  2. If `Confirm:` is present, ask the user the question. If they confirm the outcome, you're done. If they say it's wrong, offer to delete the snippet so it doesn't enter the library on a bad first impression:
     ```bash
     node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs delete <name>
     ```
- `Duplicate: <existing-name>` — invoke the existing one instead.
- `no-session: ...` — re-run `forge-session.sh`.
- `cannot-author: <reason>` — surface the reason; consider whether you misunderstood the goal.

## What you must NOT do

- **Don't drive the browser yourself for authoring.** Delegate to the agent. DOM exploration noise belongs in its context.
- **Don't repair failing snippets inline.** A `stage: "run"` failure means drift; report it, optionally delete the broken snippet, delegate fresh authoring.
- **Don't write to `library/` or `staged/` directly.** Those tiers are managed by promotion machinery; the snippet-author agent always writes to `scratch/`.
- **Don't tear down the forge session.** `playwright-cli -s=forge close` / `detach` is a user-controlled lifecycle action.

## Storage layout

```
$FORGE_ROOT/                        # ~/.claude/.vive-claude/forge/
├── INDEX.md                        # auto-generated retrieval surface
├── stats.json                      # per-snippet metadata
├── scratch/  staged/  library/     # snippet tiers
├── broken/                         # quarantined; needs repair
├── sessions/                       # recorder transcripts (future)
└── chromium-profile/               # dedicated profile for managed launch
```

See `references/snippet-anatomy.md` for the snippet file format and `references/attach.md` for the session-mode state machine.
