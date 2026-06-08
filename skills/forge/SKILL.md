---
name: forge
description: "Perform repeatable user actions in a real browser — delete batches of emails, paste gifs into PRs, navigate multi-step forms, scrape pages, anything you'd rather not click through again. Triggers on 'use forge to ...' phrases AND on `/forge ...` slash invocations. Three routes: `/forge snippet <name>` for explicit cheap invocation; `/forge spec [args]` to synthesise a Playwright spec; everything else hands off to the driver agent. The skill is a thin orchestrator — driving happens in the driver agent, snippet authoring in the author agent, spec writing in the spec-writer agent."
model: haiku
effort: medium
argument-hint: "snippet <name> [json-args] | spec [url-or-description] | <description or multi-step request>"
allowed-tools: Read, Skill, WebFetch, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(playwright-cli:*), Bash(curl -sf -m * http://localhost:9222/json/version*)
---

# forge

A browser assistant for repeatable user actions. The primary use case is replacing routine browser drudgery — anything you'd rather not click through yourself again. Snippets are how forge remembers what worked; specs are an optional export for when CI / regression / repro cares.

This skill is a **thin orchestrator**. Three agents do all the real work:

- **`forge:driver`** — executes the task in the browser, leaves a clean log of drove + invoked + (optional) note events in the session transcript
- **`forge:author`** — reads the transcript after the driver returns, decides which chunks deserve to be saved as snippets, writes them to scratch/
- **`forge:spec-writer`** — reads the transcript and writes a runnable `.spec.ts` (only in spec mode)

The skill's job is to call them in the right order with the right inputs. It does not decompose tasks, decide what to save, drive the browser, or write any files itself.

If the user is asking about something that *isn't* in a browser, you're in the wrong skill.

## Routes

Three routes, decided by parsing `$ARGUMENTS`:

1. **`snippet <name> [json-args]`** — Direct invoke. Skip everything; just run the named snippet. Cheap muscle-memory path. See **Direct route** below.
2. **`spec [url-or-description]`** — Spec route. Drive (if there's a description), then write spec + author snippets in parallel. See **Spec route** below.
3. **Anything else** — Driver route. Drive, then author snippets. See **Driver route** below.

All routes share the same bootstrap + session preamble.

## Preamble (all routes)

Always run the bootstrap once — idempotent, fast no-op on subsequent calls:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-bootstrap.sh
```

Emits `FORGE_ROOT=…`, `FORGE_PROFILE=…`, `FORGE_SESSION=forge`, `PLAYWRIGHT_CLI=…` as `KEY=VALUE` lines. Capture `FORGE_ROOT` — you'll pass it to the agents in their prompts.

Before any browser work, ensure the `forge` playwright-cli session is active:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-session.sh --probe-only
```

- Exit 0 → session is established.
- Exit 1 → no session and no CDP browser to attach to. **Just launch one** — the user invoked forge, they need a browser:
  ```bash
  bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-session.sh
  ```
  Launches managed Chrome (headed) with a dedicated profile. Separate from the user's everyday Chrome. If the user *was* already browsing in a CDP-enabled Chromium-family browser (`--remote-debugging-port=9222`), the script attaches to it instead; briefly note that, since side effects propagate to their actual browsing.

## Direct route — `snippet <name> [json-args]`

Just invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs invoke <name> '<json-args>'
```

If `<json-args>` was omitted, use `{}`. Report the result. No INDEX read, no agents, no authoring — this path is deliberately bare metal.

## Driver route — anything that isn't `snippet ...` or `spec ...`

Two agent calls in sequence: driver then author.

### 1. Drive

```
Agent(subagent_type="forge:driver",
  prompt="<the user's request verbatim, plus any context they mentioned>")
```

The driver returns one of:

- `Drove: <summary>` followed by `Steps:` `Result:` (and optionally `Note:`). Relay the `Result:` value to the user as the answer; surface any `Note:` line concisely.
- `no-session: ...` → re-run `forge-session.sh` (rare; preamble should have caught this).
- `cannot-drive: <reason>` → surface to the user. Don't try to do the task yourself; the agent has already exhausted reasonable attempts. Skip the author step in this case.

### 2. Author

After a successful drive, hand the transcript to the author:

```
Agent(subagent_type="forge:author",
  prompt="Task: <original user request>
Session ID: <CLAUDE_CODE_SESSION_ID>
FORGE_ROOT: <FORGE_ROOT from bootstrap>")
```

The author returns a manifest like `Authored: 2 snippets\n  - hn-top-story-title — Read top story title from Hacker News\n  - ...`. Surface this briefly:

> Done — <driver's result>. (Library grew: <author's manifest summary>.)

If the author returned `Authored: 0 snippets`, don't mention authoring at all.

## Spec route — `spec [url-or-description]`

Three argument shapes:

- **`spec`** *(no args)* — retrospective. Write a spec from the current session's transcript as-is. Skip the driver call.
- **`spec <URL>`** — fetch the URL via WebFetch (suggest paste if auth-required), then hand the fetched content to the driver as the description, then write the spec + author.
- **`spec <freeform text>`** — hand the description to the driver, then write the spec + author.

The flow:

### 1. Drive (if a description was provided)

Same as the Driver route's step 1. Skip if the user invoked `spec` with no args (retrospective on existing transcript).

### 2. Spec-writer and author in parallel

After the driver returns (or immediately, if retrospective), launch both downstream agents concurrently. They're independent consumers of the same transcript.

```
[parallel]
Agent(subagent_type="forge:spec-writer",
  prompt="Task: <original user request>
Session ID: <CLAUDE_CODE_SESSION_ID>
FORGE_ROOT: <FORGE_ROOT>
Label: <if user supplied one, else omit>")

Agent(subagent_type="forge:author",
  prompt="Task: <original user request>
Session ID: <CLAUDE_CODE_SESSION_ID>
FORGE_ROOT: <FORGE_ROOT>")
```

### 3. Report

Surface the spec-writer's manifest plus a brief note from the author:

> Spec written: `<label>` at `~/.claude/.vive-claude/forge/specs/<label>.spec.ts`. Run it: `node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs run <label>`. To keep it: copy into your project's tests directory.
>
> Library: <author's manifest summary, if anything was authored>.

## What you must NOT do

- **Don't drive the browser yourself.** Delegate to `forge:driver`. The skill is an orchestrator — it doesn't decompose tasks, doesn't decide per-step strategy, doesn't drive. If you find yourself reaching for `playwright-cli ...` directly, you've taken the wrong route.
- **Don't decide what snippets to write or what to put in a spec.** Those are the author's and spec-writer's jobs.
- **Don't write to `scratch/`, `staged/`, `library/`, `broken/`, or `specs/` directly.** The agents own those.
- **Don't tear down the forge session.** `playwright-cli -s=forge close` / `detach` is user-controlled.
- **Don't second-guess any agent.** If the driver returns `cannot-drive`, surface the reason and stop. If the author writes nothing, that's fine — not every drive yields new snippets.

## Storage layout

```
$FORGE_ROOT/                        # ~/.claude/.vive-claude/forge/
├── INDEX.md                        # auto-generated by forge:author after writes
├── stats.json                      # per-snippet metadata (useCount, tier, lastUsed)
├── scratch/  staged/  library/     # snippet tiers; promotion automatic on reuse
├── broken/                         # quarantined; needs repair
├── sessions/<session-id>.jsonl     # per-Claude-session transcript: drove + invoked + note events
├── specs/<label>.spec.ts           # generated specs
├── runner/                         # bundled Playwright workspace for `forge-spec.mjs run`
└── chromium-profile/               # dedicated profile for managed launch
```

See `references/snippet-anatomy.md` for the snippet file format and `references/attach.md` for the session-mode state machine.
