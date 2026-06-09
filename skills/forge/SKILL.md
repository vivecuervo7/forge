---
name: forge
description: "Perform repeatable user actions in a real browser — delete batches of emails, paste gifs into PRs, navigate multi-step forms, scrape pages, anything you'd rather not click through again. Triggers on 'use forge to ...' phrases AND on `/forge ...` slash invocations. Three routes: `/forge snippet <name>` for explicit cheap invocation; `/forge spec [args]` to synthesise a Playwright spec; everything else hands off to the driver agent. The skill is a thin orchestrator — driving happens in the driver agent, snippet authoring in the author agent, spec writing in the spec-writer agent."
model: haiku
effort: medium
argument-hint: "snippet <name> [json-args] | spec [url-or-description] | doctor | <description or multi-step request>"
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

Four routes, decided by parsing `$ARGUMENTS`:

1. **`snippet <name> [json-args]`** — Direct invoke. Skip everything; just run the named snippet. Cheap muscle-memory path. See **Direct route** below.
2. **`spec [url-or-description]`** — Spec route. Drive (if there's a description), then write spec + author snippets in parallel. See **Spec route** below.
3. **`doctor`** — Diagnostic route. Run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-doctor.sh` and relay its checklist output verbatim. Read-only — confirms data root, snippet tiers, playwright-cli install, session state, and CDP browser presence. Skip the bootstrap + session preamble; the doctor is what tells the user whether those are wired up. Add no commentary unless a check fails, in which case quote the remedy line beside the failure.
4. **Anything else** — Driver route. Drive, then author snippets. See **Driver route** below.

The first two routes and the driver route share the same bootstrap + session preamble. The doctor route skips it.

## Preamble (all routes)

Always run the bootstrap once — idempotent, fast no-op on subsequent calls:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-bootstrap.sh
```

Emits `FORGE_ROOT=…` and `PLAYWRIGHT_CLI=…` as `KEY=VALUE` lines. Capture `FORGE_ROOT` — you'll pass it to the agents in their prompts.

Then ensure this Claude session has a browser. forge launches a managed headed Chrome per Claude session by default — each Claude session gets its own browser + profile under `$FORGE_ROOT/runs/<session-id>/`, so concurrent sessions (e.g. across worktrees) don't collide:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-session.sh
```

This emits `FORGE_SESSION=…`, `FORGE_PORT=…`, `FORGE_MODE=…`, `FORGE_PROFILE=…` as `KEY=VALUE` lines. Capture `FORGE_SESSION` — you'll pass it to the driver in its prompt alongside `FORGE_ROOT`.

If a session for this Claude session is already live, the script no-ops and re-emits the existing values. If the user has set `FORGE_CDP_PORT=<port>` in their env, the script attaches to the CDP browser on that port instead (opt-in attach mode — useful for "drive my live browser" workflows; note that side effects propagate to their actual browsing).

### Orphan check (skip on the doctor route)

After session setup, scan for forge sessions whose parent Claude session is no longer active:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-find-orphans.sh
```

The script prints one `<session-id>\t<playwright-name>\t<reason>` line per orphan, or nothing when all is clean. The reason is one of:

- `parent-pid-gone` — the Claude process that spawned the daemon is no longer running. **Definitive orphan**.
- `parent-pid-reused` — the recorded PID is alive but no longer a Claude process. **Definitive orphan**.
- `jsonl-stale <age>` — legacy fallback: state.json predates 0.7.1 (no parent_claude_pid recorded), and the Claude transcript jsonl hasn't been touched in 60min+. **Likely orphan; the originating Claude may still be alive but idle**.
- `no-transcript` — legacy fallback: no Claude jsonl found at all. **Likely orphan**.

**If output is empty**: stay silent, proceed with the task.

**If output is non-empty**: surface to the user via `AskUserQuestion` with `multiSelect: true`. Each orphan becomes one option labelled `forge-<short-id> (<reason>)`. Frame the question as something like:

> Found N orphan forge session(s) — Claude sessions that ended but their browser daemon kept running (~200MB RAM + a Chrome process each). Closing them frees the resources; transcripts in `sessions/` are preserved either way. Which would you like to close?

The user selects zero or more orphans to close. For each selected:

```bash
playwright-cli -s=<playwright-name> close
```

Then continue with the actual task. Orphans the user didn't pick stay alive; the next forge invocation will surface them again.

Don't ask if the only orphans are "definitive" types AND the count is small (≤2) AND the user has just invoked forge after a likely-clean exit pattern — but err toward asking; this is a low-frequency event and missing a confirmation is cheap.

## Direct route — `snippet <name> [json-args]`

Just invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs invoke <name> '<json-args>'
```

If `<json-args>` was omitted, use `{}`. Report the result. No INDEX read, no agents, no authoring — this path is deliberately bare metal.

## Driver route — anything that isn't `snippet ...` or `spec ...`

### 1. Drive

**Driver's prompt is ONLY the user's task** (plus leading `FORGE_ROOT` and `FORGE_SESSION` lines). Do not mention any downstream agents or post-drive steps in the prompt — that context confuses the driver into trying to invoke other skills from inside itself.

```
Agent(subagent_type="forge:driver",
  prompt="FORGE_ROOT: $FORGE_ROOT
FORGE_SESSION: $FORGE_SESSION

<the user's request verbatim, plus any context they mentioned>")
```

The leading lines let the agent honor the same root + per-Claude-session browser the skill resolved during bootstrap — important when a wrapper has set a non-default root, and required for the driver to talk to the right browser when multiple Claude sessions are active.

The driver returns one of:

- `Drove: <summary>` followed by `Steps:` `Result:` (and optionally `Note:`) — continue to step 2.
- `no-session: <reason>` — relay to the user and re-run `forge-session.sh`; do not continue.
- `cannot-drive: <reason>` — relay to the user verbatim; do not continue.

### 2. Check whether new library work happened

```bash
FORGE_ROOT=$FORGE_ROOT bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-has-novel-work.sh
```

The script prints a single token to stdout:

- **`novel`** — the driver did browser work that may be worth extracting as snippets. Continue to step 3.
- **`reuse-only`** — every step in the drive used an existing library snippet. The flow ends here; report:
  > <driver's result>. (Task completed using existing library snippets.)

### 3. Author (when step 2 prints `novel`)

```
Agent(subagent_type="forge:author",
  prompt="FORGE_ROOT: $FORGE_ROOT
Task: <original user request verbatim>")
```

The author reads `CLAUDE_CODE_SESSION_ID` from env and uses the `FORGE_ROOT` you pass — do not put session ID in the prompt.

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
FORGE_ROOT=$FORGE_ROOT bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-has-novel-work.sh
```

### 3. Launch downstream agents

Agents read `CLAUDE_CODE_SESSION_ID` from env and use the `FORGE_ROOT` you pass — do not put session ID in any prompt.

Read step 2's stdout token:

- **`novel`** — launch spec-writer and author in parallel:
  ```
  [parallel]
  Agent(subagent_type="forge:spec-writer",
    prompt="FORGE_ROOT: $FORGE_ROOT
  Task: <original user request verbatim>
  Label: <if user supplied one, else omit this line>")

  Agent(subagent_type="forge:author",
    prompt="FORGE_ROOT: $FORGE_ROOT
  Task: <original user request verbatim>")
  ```

- **`reuse-only`** — launch spec-writer alone:
  ```
  Agent(subagent_type="forge:spec-writer",
    prompt="FORGE_ROOT: $FORGE_ROOT
  Task: <original user request verbatim>
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
