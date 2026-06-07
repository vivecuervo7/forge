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

Triggered when `$ARGUMENTS` starts with the verb `spec`. Three argument shapes route the same downstream pipeline:

- `spec` *(no args)* — **retrospective.** Read the current session's transcript (`$CLAUDE_CODE_SESSION_ID` → `$FORGE_ROOT/sessions/<session-id>.jsonl`), present the events to the user, run the review loop, write a spec.
- `spec <URL>` — **prospective from URL.** Fetch the URL (WebFetch for public; if it returns 403/auth-required and the URL looks like Jira/Linear/etc., suggest the user paste the contents directly). Use the fetched body as the description. Drive the described flow via existing NL-mode orchestration. Then drop into the review loop.
- `spec <freeform text>` — **prospective from description.** Same as URL mode, just skip the fetch step.

Each step the user does in spec mode either invokes an existing snippet or delegates to `forge:snippet-author` for fresh authoring — exactly the same pipeline as NL mode. The transcript-hook in the registry captures every successful invoke and authoring outcome automatically, so by the time you've driven the described flow, the transcript is already populated. No special recording machinery needed.

### Retrospective flow (`spec` with no args)

1. Load events for the current session:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs events "$CLAUDE_CODE_SESSION_ID"
   ```
   Returns a JSON array of numbered events (`{index, ts, event, snippet, args, result, hadResult, tier}`).

   If the array is empty: ask the user what they want to spec, falling through to **prospective flow** with their reply as the description.

2. Present the events to the user in chat — concise, numbered, readable. Don't dump JSON. Something like:

   > Here's what I have in this session:
   > 1. `hn-first-story-comments` → returned `{count: 56, title: "Valve P2P..."}`
   > 2. `translate-to-french` (authored) → returned `"Le réseau..."`
   > 3. `gmail-compose-new` → opened compose window
   >
   > Want to spec this as-is, add more steps, add assertions, or skip parts? (Or tell me to spec something else entirely.)

3. Interpret the user's reply naturally — examples of what they might say:
   - *"spec it"* → no slicing, propose a terminal assertion (see step 4), then write
   - *"drop step 1"* → slice with `drop: [1]`
   - *"start from step 2"* → slice with `startAt: 2`
   - *"add a step that <X>"* → fall back to NL-mode orchestration for the additional steps (which extend the transcript), then re-load events and re-present
   - *"assert <something>"* → see step 5
   - *"spec something else: <description>"* → switch to prospective flow

4. **Propose ONE terminal assertion** based on the last retained event's result (see `references/spec-format.md` for the heuristics by result shape). Skip the proposal if `hadResult: false`. Present as a suggestion the user can accept, reword, or skip:

   > For the final step, want to assert `expect(step3Result).toMatch(/Le réseau/)`? Or write your own?

5. **Convert user-supplied assertion language into Playwright `expect(...)` statements.** The user might say *"assert the title contains 'Valve'"* → emit `expect(step1Result.title).toContain('Valve')`. The skill is responsible for this conversion; the `forge-spec.mjs write` subcommand takes raw `expect(...)` strings.

6. Pick a **label** (kebab-case). If the user hasn't named the spec, propose one based on the recipe (e.g. `hn-translate-email`). Confirm before writing.

7. Write the spec:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs write "$CLAUDE_CODE_SESSION_ID" '{"startAt":<n>,"drop":[<n>],"assertions":["<expect(...)>"],"label":"<label>"}'
   ```

8. Report the output path and remind the user to copy it to their project's test directory:

   > Spec written to `~/.claude/.vive-claude/forge/specs/<label>.spec.ts`. Copy it into your project's tests directory when you're ready.

### Prospective flow (`spec <URL>` or `spec <description>`)

1. If args looks like a URL (matches `https?://`):
   - WebFetch it. If the fetch returns auth-required content, suggest the user paste the body inline ("looks like that URL needs auth; paste the contents and I'll work from that").
   - Use the fetched content as the description.
2. Plan the steps from the description using the same multi-step decomposition as NL mode. Each step is matched to an existing snippet or marked for fresh authoring.
3. Drive the steps in order — invoking the registry for existing snippets, delegating to `forge:snippet-author` for new ones. The transcript-hook records each step automatically.
4. When driving completes, **drop into the retrospective flow** with the just-completed events. The user can confirm, slice, or extend before the spec is written.

### Failure modes in spec mode

- **No transcript for current session** + `spec` with no args: ask the user what to spec; fall through to prospective.
- **WebFetch fails on a URL**: suggest paste, don't fail silently.
- **Driving fails mid-prospective**: stop, surface the failure (per the regular NL-mode failure handling — recovery is allowed but bounded), and ask whether the user still wants to spec the partial transcript.
- **A snippet referenced in the transcript is missing from disk** (deleted between recording and spec write): `forge-spec.mjs write` errors out; surface the snippet name to the user.

See `references/spec-format.md` for the `.spec.ts` template, redaction rules, content-hash format, and assertion-proposal heuristics.

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
