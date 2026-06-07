---
name: forge
description: "Perform repeatable user actions in a real browser — delete batches of emails, paste gifs into PRs, navigate multi-step forms, scrape pages, anything you'd rather not click through again. Triggers on 'use forge to ...' phrases AND on `/forge ...` slash invocations. Three routes: `/forge snippet <name>` for explicit cheap invocation; `/forge spec [args]` to synthesise a Playwright spec; everything else hands off to the driver agent which owns end-to-end execution. The skill itself is a thin router — it never decomposes tasks, decides per-step strategy, or drives the browser directly. Snippet library grows automatically via post-driver collation."
model: haiku
effort: medium
argument-hint: "snippet <name> [json-args] | spec [url-or-description] | <description or multi-step request>"
allowed-tools: Read, Skill, WebFetch, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(playwright-cli:*), Bash(curl -sf -m * http://localhost:9222/json/version*)
---

# forge

A browser assistant for repeatable user actions. The primary use case is replacing routine browser drudgery — anything you'd rather not click through yourself again. Snippets are how forge remembers what worked; specs are an optional export for when CI / regression / repro cares.

This skill is a **thin router**. It does NOT decompose tasks, decide per-step strategy, or drive the browser itself. All multi-step driving is delegated to the `forge:driver` agent, which owns end-to-end execution. Snippet creation is automatic — a post-driver collation step (`forge-registry.mjs collate`) heuristically extracts reusable patterns from the transcript. No mid-flow snippet-authoring decisions.

If the user is asking about something that *isn't* in a browser, you're in the wrong skill.

## Routes

Three routes, decided by parsing `$ARGUMENTS`:

1. **`snippet <name> [json-args]`** — Direct invoke. Skip everything; just run the named snippet. Cheap muscle-memory path. See **Direct route** below.
2. **`spec [url-or-description]`** — Spec route. Drive (if there's a description), then synthesise a `.spec.ts`. See **Spec route** below.
3. **Anything else** — Driver route. Hand the request off to `forge:driver`. See **Driver route** below.

All routes share the same bootstrap + session preamble.

## Preamble (all routes)

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

## Direct route — `snippet <name> [json-args]`

Just invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs invoke <name> '<json-args>'
```

If `<json-args>` was omitted, use `{}`. Report the result. No INDEX read, no matching, no driver — this path is deliberately bare metal.

## Driver route — anything that isn't `snippet ...` or `spec ...`

Hand the whole request off to `forge:driver`. The agent reads INDEX, decomposes the task, invokes existing snippets where they fit, drives inline (via `forge-registry.mjs drive`) for steps without a snippet, and returns the task outcome. Everything is recorded to the transcript automatically.

```
Agent(subagent_type="forge:driver",
  prompt="<the user's request verbatim, plus any context they mentioned>")
```

The agent returns one of:

- `Drove: <summary>` followed by `Steps:` `Result:` (and optionally `Note:`). Relay the `Result:` value to the user as the answer; surface any `Note:` line concisely.
- `no-session: ...` → re-run `forge-session.sh` (rare; the preamble should have caught this).
- `cannot-drive: <reason>` → surface to the user. Don't try to do the task yourself; the agent has already exhausted reasonable attempts.

After a successful drive, run the post-driver collation pass — this is what grows the snippet library from observed reusable patterns:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs collate
```

The script reads the session transcript, identifies consecutive drove-event groups that look reusable (heuristics: ≥2 actions, includes an action verb, doesn't duplicate an existing snippet's body), and creates them as snippets in `scratch/`. The summary lists what was created/skipped. Mention it briefly if anything was created:

> Done — <agent's result>. (Library grew: added `<name>` from this run.)

If nothing was created, don't mention collation at all.

## Spec route — `spec [url-or-description]`

Three argument shapes:

- **`spec`** *(no args)* — retrospective. Write a spec from the current session's transcript as-is.
- **`spec <URL>`** — fetch the URL via WebFetch (suggest paste if auth-required), then hand the fetched content to the driver as the description, then write the spec.
- **`spec <freeform text>`** — hand the description to the driver, then write the spec.

The flow:

1. **If a description (URL or text) was provided**, delegate to the driver agent (same as the Driver route above) with the description as its task.
2. **Always** call `forge-spec.mjs write` to synthesise the spec from whatever's in the transcript:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs write '{}'
   ```
3. **Relay the `summary` field** from the returned JSON.
4. **Run collation** (same as the Driver route — library growth from the run's drove events):
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs collate
   ```
5. **Tell the user how to run / keep the spec**:
   > Spec lives at `~/.claude/.vive-claude/forge/specs/<label>.spec.ts`. Run it: `node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs run <label>`. To keep it: copy into your project's tests directory.

The script handles everything mechanical: session-id from env, label derived from the transcript's events (including drove blocks), terminal assertion shape-detected from the last step, snippet bodies inlined, drove blocks emitted as inline code, credentials redacted, file written atomically. No model interaction needed for any of those decisions.

If `write` returns an error (no transcript, no events), surface the message verbatim.

### When the user redirects after seeing a spec

The user may push back — "drop step 2", "different label", "assert URL contains /pull/", "add a step that does X". The redirect path:

1. Show what's in the transcript: `forge-spec.mjs events`
2. Interpret the user's request into options. Common shapes:
   - *"drop step 2"* → `{"drop":[2]}`
   - *"start from step 3"* → `{"startAt":3}`
   - *"label it 'hn-fr-mail'"* → `{"label":"hn-fr-mail"}`
   - *"assert URL contains /pull/"* → `{"assertions":["expect(stepNResult).toContain('/pull/')"]}` (N matches the step's index in the generated spec)
   - *"add a step that does X"* → delegate to driver with the addition; transcript extends; call `write` again
3. Re-write with overrides:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-spec.mjs write '{"drop":[2],"label":"hn-fr-mail"}'
   ```

> Note: `$FORGE_SESSION` (the playwright-cli session name, literally `forge`) and `$CLAUDE_CODE_SESSION_ID` (Claude Code's session UUID) are two different things. The script reads the latter from env automatically; you never need to pass it.

See `references/spec-format.md` for the `.spec.ts` template, redaction rules, content-hash format, and assertion heuristics — all baked into the script; the reference exists for understanding the output, not for the skill to enact.

## What you must NOT do

- **Don't drive the browser yourself for multi-step tasks.** Delegate to `forge:driver`. The whole point of this architecture is that the skill is a router — it doesn't decompose tasks, doesn't decide per-step strategy, doesn't drive. If you find yourself reaching for `playwright-cli ...` directly, you've taken the wrong route.
- **Don't decide whether to author snippets.** The collation step does that automatically based on heuristics over the transcript. You never call `forge-registry.mjs record-authoring` or write to scratch/ directly.
- **Don't write to `library/` or `staged/` directly.** Those tiers are managed by promotion machinery.
- **Don't tear down the forge session.** `playwright-cli -s=forge close` / `detach` is user-controlled.
- **Don't second-guess the driver agent.** If it returns `cannot-drive`, surface the reason and stop. Don't try to do the task yourself.

## Storage layout

```
$FORGE_ROOT/                        # ~/.claude/.vive-claude/forge/
├── INDEX.md                        # auto-generated retrieval surface
├── stats.json                      # per-snippet metadata
├── scratch/  staged/  library/     # snippet tiers
├── broken/                         # quarantined; needs repair
├── sessions/<session-id>.jsonl     # per-Claude-session transcripts (invoked + authored + drove events)
├── specs/<label>.spec.ts           # generated specs
└── chromium-profile/               # dedicated profile for managed launch
```

See `references/snippet-anatomy.md` for the snippet file format and `references/attach.md` for the session-mode state machine.
