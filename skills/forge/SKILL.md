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

### 1. Drive

**Driver's prompt is ONLY the user's task.** Do not mention any downstream agents or post-drive steps in the prompt — that context confuses the driver into trying to invoke other skills from inside itself.

```
Agent(subagent_type="forge:driver",
  prompt="<the user's request verbatim, plus any context they mentioned>")
```

The driver returns one of:

- `Drove: <summary>` followed by `Steps:` `Result:` (and optionally `Note:`) — continue to step 2.
- `no-session: <reason>` — relay to the user and re-run `forge-session.sh`; do not continue.
- `cannot-drive: <reason>` — relay to the user verbatim; do not continue.

### 2. Check whether new library work happened

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-has-novel-work.sh
```

The script prints a single token to stdout:

- **`novel`** — the driver did browser work that may be worth extracting as snippets. Continue to step 3.
- **`reuse-only`** — every step in the drive used an existing library snippet. The flow ends here; report:
  > <driver's result>. (Task completed using existing library snippets.)

### 3. Author (when step 2 prints `novel`)

```
Agent(subagent_type="forge:author",
  prompt="Task: <original user request verbatim>")
```

The author reads `CLAUDE_CODE_SESSION_ID` from env and uses the canonical data root path — do not put session ID or paths in the prompt.

The author returns a manifest like `Authored: 2 snippets\n  - <name> — <description>\n  - ...`. Report:

> <driver's result>. (Library grew: <author's manifest summary>.)

If the author returned `Authored: 0 snippets`, omit the library line.

## Spec route — `spec [url-or-description]`

Three argument shapes:

- **`spec`** *(no args)* — retrospective. Write a spec from the current session's transcript as-is. Skip the driver call.
- **`spec <URL>`** — fetch the URL via WebFetch (suggest paste if auth-required), then hand the fetched content to the driver as the description, then write the spec + author.
- **`spec <freeform text>`** — hand the description to the driver, then write the spec + author.

The flow:

### 1. Drive (if a description was provided)

Same as the Driver route's step 1 — including the rule that the driver's prompt is ONLY the user's task, with no mention of spec-writer or author. Skip the driver call entirely if the user invoked `spec` with no args (retrospective on existing transcript).

### 2. Check whether new library work happened

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-has-novel-work.sh
```

### 3. Launch downstream agents

Agents read `CLAUDE_CODE_SESSION_ID` from env and use the canonical data root — do not put session ID or paths in any prompt.

Read step 2's stdout token:

- **`novel`** — launch spec-writer and author in parallel:
  ```
  [parallel]
  Agent(subagent_type="forge:spec-writer",
    prompt="Task: <original user request verbatim>
  Label: <if user supplied one, else omit this line>")

  Agent(subagent_type="forge:author",
    prompt="Task: <original user request verbatim>")
  ```

- **`reuse-only`** — launch spec-writer alone:
  ```
  Agent(subagent_type="forge:spec-writer",
    prompt="Task: <original user request verbatim>
  Label: <if user supplied one, else omit this line>")
  ```

### 4. Report

Surface the spec-writer's manifest plus the author's, if both ran:

> Spec written: `<label>` at `~/.claude/.vive-claude/forge/specs/<label>.spec.ts`. Run it: `node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs run <label>`. To keep it: copy into your project's tests directory.
>
> Library: <author's manifest summary, if the author ran and authored anything>.

## Hard rules

- **The skill is an orchestrator, not an actor.** Multi-step driving belongs to `forge:driver`; snippet authoring to `forge:author`; spec writing to `forge:spec-writer`. Your only direct action is bootstrap + session preamble + the agent invocations described above.
- **Surface what the agents return; don't second-guess them.** If the driver returns `cannot-drive`, relay the reason and stop. If the author writes zero snippets, that's a normal outcome of a drive that only invoked existing snippets — don't manufacture a different summary.

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
