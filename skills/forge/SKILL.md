---
name: forge
description: "Perform repeatable user actions in a real browser — delete batches of emails, paste gifs into PRs, navigate multi-step forms, scrape pages, anything you'd rather not click through again. Triggers on 'use forge to ...' phrases AND on `/forge ...` slash invocations. Entry points: `/forge snippet <name>` for explicit cheap invocation of a known snippet; `/forge spec [args]` to synthesise a Playwright spec from session activity (or from a URL / description); everything else routes through discovery, composition, and authoring delegation as needed."
model: haiku
effort: medium
argument-hint: "snippet <name> [json-args] | spec [url-or-description] | <description or multi-step request>"
allowed-tools: Read, Skill, WebFetch, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(playwright-cli:*), Bash(curl -sf -m * http://localhost:9222/json/version*)
---

# forge

A browser assistant for repeatable user actions. The primary use case is replacing routine browser drudgery — anything you'd rather not click through yourself again. Snippets are how forge remembers what worked; specs (later) are an optional export for when CI cares.

Forge is a thin wrapper around the `playwright-cli` skill: that skill owns the action vocabulary, forge owns the session lifecycle, the snippet registry, and the spec-generation pipeline. Authoring new snippets is delegated to the `forge:snippet-author` agent (noise quarantine).

If the user is asking about something that *isn't* in a browser, you're in the wrong skill.

## Modes

Look at the user's request:

1. **Direct mode** — request is the slash form `snippet <name> [json-args]` (i.e. `$ARGUMENTS` starts with the verb `snippet`). Skip discovery; invoke the named snippet directly. Cheap muscle-memory path.
2. **Spec mode** — request starts with the verb `spec` (i.e. `$ARGUMENTS` is `spec`, `spec <URL>`, or `spec <description>`). Synthesise a Playwright `.spec.ts` from session activity, a fetched URL, or a freeform description. See **Spec mode** below.
3. **NL mode** — anything else. Read INDEX.md, match the request to a snippet (possibly with arg overrides). For multi-step requests, compose snippets in order. If no snippet covers something, delegate to the author agent.

All modes share the same bootstrap + session-check preamble.

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
- Exit 1 → no session and no CDP browser to attach to. **Just launch one** — the user invoked forge, they need a browser to do anything, asking is friction:
  ```bash
  bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-session.sh
  ```
  Launches managed Chrome (headed) with a dedicated profile at `~/.claude/.vive-claude/forge/chromium-profile/`. Separate from the user's everyday Chrome — fresh cookies, fresh history. If the user *was* already browsing in a CDP-enabled Chromium-family browser (Arc/Chrome with `--remote-debugging-port=9222`), the script attaches to it instead (real cookies, real auth, real tabs); briefly note that to the user when it happens, since side effects propagate to their actual browsing.

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
- `{"ok":false,"stage":"precondition","error":"..."}` — preconditions failed. The page isn't in the expected state. Brief recovery is fine (e.g. navigate to the right URL), but if the user is somewhere genuinely unrelated, surface that and stop.
- `{"ok":false,"stage":"run","error":"..."}` — the snippet itself threw. Often recoverable from real-world DOM mess (modal dialog, unexpected pre-existing state). See **Recovery and improvisation** below.

### Recovery and improvisation

Browser state is messy in practice — pre-existing dialogs, stale tabs, partially-loaded pages, the user mid-task. Snippets are authored against clean states, so transient failures during invocation are expected. You may improvise to get the user's request done:

- Inspect the live state: `playwright-cli -s=forge tab-list`, `... snapshot`, `... url`
- Direct actions to clear blockers: `playwright-cli -s=forge dialog-dismiss`, `... click`, `... goto`, `... fill`, etc.
- Re-invoke the original snippet after addressing the blocker

**Soft cap: stop after ~5 recovery tool calls past the first failure** if you're not visibly making progress. Goal is bounded improvisation — get the user their result, but don't burn tokens thrashing for half an hour.

When recovery succeeds, **surface it in your final report** as a single optional line — don't interrupt mid-flow to ask:

> Done — <result>. (Note: `<snippet-name>` needed a hand — [brief reason]. Want me to delegate a repair so it handles this next time?)

The user may say yes (triggers a fresh authoring trip to fix the snippet — a future `forge:snippet-repair` agent will handle this; for now, delegate to `forge:snippet-author` with the failure context as the goal) or skip. Either way, the snippet library accretes from real usage rather than getting stuck on a broken first impression.

When recovery fails (cap reached, no path forward), report cleanly:

> Couldn't complete — `<snippet-name>` failed with `<error>` and recovery didn't succeed. The snippet likely needs re-authoring. Want me to delegate that?

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

## Spec mode

Triggered when `$ARGUMENTS` starts with the verb `spec`. Three argument shapes; all converge on the same final step: call `forge-spec.mjs write` and relay the result.

- `spec` *(no args)* — **retrospective.** Write a spec from the current session's transcript as-is.
- `spec <URL>` — **prospective from URL.** Fetch the URL via WebFetch (suggest paste if auth-required), then drive the fetched description, then write.
- `spec <freeform text>` — **prospective from description.** Drive the description, then write.

### The default path (just call the script, trust the output)

For the common case — both retrospective and prospective — the skill's job is small:

1. **If prospective**, drive the described steps using normal NL-mode orchestration (invoke existing snippets, delegate to `forge:snippet-author` for new ones). The transcript-hook automatically records every successful invoke / authoring; you don't manage that.
2. **Always** finish with a single call:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs write '{}'
   ```
3. **Relay the `summary` field** from the returned JSON, plus a one-line reminder that the file lives at `$FORGE_ROOT/specs/` and the user can copy it into their tests directory.

The script handles everything mechanical: session-id from env, label derived from snippet names, terminal assertion shape-detected from the last step's result, snippet bodies inlined, credentials redacted, file written atomically. No model interaction needed for any of those decisions.

If `write` returns an error (no transcript, no events, missing snippet on disk), surface the message verbatim — the script's error text is intended to be user-facing.

### When the user redirects

The user may push back after seeing the auto-written spec — "drop step 2", "different label", "assert URL contains /pull/", "add a step that does X". Only then do you fall into the explicit-overrides path:

1. Show what's in the transcript:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs events
   ```
   Returns numbered events (`{index, ts, event, snippet, args, result, hadResult, tier}`). Present a concise numbered list to the user — don't dump raw JSON.

2. Interpret the user's request into options:
   - *"drop step 2"* → `{"drop":[2]}`
   - *"start from step 3"* → `{"startAt":3}`
   - *"label it 'hn-fr-mail'"* → `{"label":"hn-fr-mail"}`
   - *"assert URL contains /pull/"* → `{"assertions":["expect(stepNResult).toContain('/pull/')"]}` (replace N with the appropriate step index — these match `step<N>Result` variables in the generated spec)
   - *"add a step that does X"* → drive X via NL-mode orchestration (extends the transcript), then call `write` again with the user's other overrides

3. Re-write with the overrides:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs write '{"drop":[2],"label":"hn-fr-mail"}'
   ```

### Failure modes

The script's error messages are descriptive — pass them through unedited. Specifically:

- **No transcript** + retrospective `spec`: ask the user what to spec; fall through to prospective with their reply.
- **WebFetch fails on a URL**: suggest paste, don't fail silently.
- **Driving fails mid-prospective**: stop, surface the failure (per the regular Recovery and improvisation discipline above). If recovery succeeded but the underlying snippet failed cleanly, that step won't be in the transcript and therefore won't be in the spec — mention this and offer to delegate a repair before writing.

> Note: `$FORGE_SESSION` (the playwright-cli session name, literally `forge`) and `$CLAUDE_CODE_SESSION_ID` (Claude Code's session UUID) are two different things. The script reads the latter from env automatically; you never need to pass it. If you ever see a "no transcript for session forge" error, you're somehow passing `$FORGE_SESSION` where the script expected the env var — just remove the explicit arg.

See `references/spec-format.md` for the `.spec.ts` template, redaction rules, content-hash format, and assertion-proposal heuristics — these are all baked into the script; the reference exists for understanding the output, not for the skill to enact.

## What you must NOT do

- **Don't drive the browser yourself for *authoring*.** Authoring (creating a new repeatable snippet) goes through the `forge:snippet-author` agent — DOM exploration noise belongs in its context, not this conversation. *Recovery* from a transient failure during invocation is different and allowed (see Recovery and improvisation above).
- **Don't edit snippet `.ts` files inline to patch them.** Improvising around a failure to complete the user's task is fine; modifying the snippet itself is the (future) repair agent's job. For now, surface the failure pattern in your report and offer to delegate a repair.
- **Don't write to `library/` or `staged/` directly.** Those tiers are managed by promotion machinery; the snippet-author agent always writes to `scratch/`.
- **Don't tear down the forge session.** `playwright-cli -s=forge close` / `detach` is a user-controlled lifecycle action.
- **Don't let improvisation become the default path.** If a snippet routinely needs you to paper over it, the snippet is broken — note it and offer repair. The goal is repeatable snippets that "just work"; improvisation is a recovery mechanism, not a substitute for fixing brittle snippets.

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
