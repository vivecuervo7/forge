---
name: forge
description: "Browser-automation agent team for Claude Code. Five routes under one skill: `/forge <task>` (drive mode — driver + snippet-author do the task end-to-end), `/forge spec <task>` (spec mode — also produces a verified Playwright spec), `/forge run <spec>` (re-run a verified spec, optionally recording a video for evidence), `/forge init` (scaffold the forge/ directory convention in CWD), `/forge export <name>` (inline a composed spec for shipping outside forge/). Walks up from CWD to find the project's forge/ directory, dispatches to a route-specific reference for the rest of the work."
model: sonnet
effort: medium
argument-hint: "[spec|run|init|export] <args>"
allowed-tools: Read, Glob, Skill, AskUserQuestion, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(direnv:*), Bash(playwright-cli:*), Bash(mkdir:*), Bash(jq:*), Bash(cat:*), Bash(echo:*), Bash(ls:*), Agent, SendMessage, TeamCreate, TeamDelete, TaskCreate, TaskList, TaskGet, TaskUpdate
---

# /forge

`/forge` is a single skill with four routes. This SKILL.md is a thin router — it parses the route, captures route-specific context, and dispatches to a reference file that contains the actual instructions for that route. Only the reference for the chosen route is loaded; init/export invocations don't pull in team-orchestration content, and task/spec invocations don't pull in scaffold or export logic.

## Phase 0 — Pick the route

Look at the first word of `$ARGUMENTS` (case-insensitive). The dispatch table:

| First word | Route | Loaded reference | Rest of args becomes |
|---|---|---|---|
| `init` | scaffold a forge/ directory | `references/init.md` | optional target dir |
| `export` | inline a composed spec for shipping | `references/export.md` | spec name + optional `--output <path>` |
| `run` | re-run a verified spec, optionally recording | `references/run.md` | spec name / `last` / `latest`, plus optional `record as <label>` |
| `spec` | spec mode — drive + write spec + verify | `references/team-task.md` (with `MODE=spec`) | the actual task description |
| *(anything else)* | (see natural-language signals below; default fallback is the task route) | `references/team-task.md` (with `MODE=drive`) | the full args = task description |

### Natural-language route signals (when first word doesn't match)

When the first word isn't a route keyword, check the full args for these natural-language phrasings before falling through to the task route. The phrase has to genuinely express the route's intent — a single keyword in passing isn't enough.

**Init route** — an init-verb combined with `forge` as the object:

- "install forge here" / "install forge in this project"
- "scaffold forge" / "scaffold forge here" / "scaffold the forge directory"
- "set up forge" / "set up forge in this project"
- "initialise forge" / "initialize forge"

**Export route** — an export-verb combined with a spec reference:

- "ship this spec" / "ship the spec for the team" / "ship that spec"
- "inline this spec" / "inline the snippets in <name>"
- "export the spec from the latest recording" *(also matches the first-word `export` keyword — the NL pattern is redundant-safe)*

If a natural-language signal matches, set the route accordingly and pass the full args (no keyword stripping; the reference handles parsing them).

If neither first-word nor natural-language matches, the route stays task and Phase 0a applies.

Counter-examples that should NOT match:

- "log in and ship the package to checkout" — "ship" appears but not paired with `spec`
- "install the user via this API" — "install" appears but not paired with `forge`
- "spec the backpack feature out for me" — colloquial "spec" with no authoring intent (Phase 0a's spec-mode detection would also reject this)

### Examples

- `/forge init` → route=init, args=""
- `/forge init ~/my-project` → route=init, args="~/my-project"
- `/forge install forge here` → route=init (via NL signal), args="install forge here"
- `/forge export add-backpack-to-cart-standard` → route=export, args="add-backpack-to-cart-standard"
- `/forge ship this spec for the team` → route=export (via NL signal), args="ship this spec for the team"
- `/forge run last spec, record as before` → route=run, args="last spec, record as before", RECORD_AS=before
- `/forge spec AE-1775 add a backpack` → route=spec, args="AE-1775 add a backpack", MODE=spec
- `/forge add the backpack to cart` → route=task, args="add the backpack to cart", MODE=drive
- `/forge create a spec for adding the backpack` → route=task, args="create a spec for adding the backpack", MODE=spec (via Phase 0a natural-language signal)

## Phase 0a — Mode detection (task/spec route only)

For task and spec routes, you also need to set `MODE` before loading the reference. Skip this section for init / export / run.

**MODE selection** — spec mode is selected when:

- Phase 0 already set `MODE=spec` because the first word was `spec`, OR
- The remaining task description contains a clear spec-authoring intent in natural language: "create a spec", "write a spec", "spec for AE-XXXX", "produce a spec that…", "capture this as a spec", "build a verification spec". Use judgment — phrases that genuinely ask for a spec artifact, not phrases that incidentally mention specs ("the spec is already correct, just drive…").

Otherwise → **drive mode**. The user wants the action performed; no spec artifact required. If intent is ambiguous, default to drive — spec creation is an explicit opt-in.

## Phase 0b — Recording label detection (run route only)

For the run route, look for a recording label in the args:

- "record as 'before'" / "record this as after" / "label it before-fix" → capture `RECORD_AS = before` / `after` / `before-fix`
- "record a before video" → `RECORD_AS = before` (extract the adjective)
- No mention → `RECORD_AS = none` — the run is verification-only, no video produced

The persisted recording filename is always `<spec-basename>-<suffix>.webm` under `forge/videos/`. Suffix is the user-supplied label or a timestamp default. Spec context stays attached so multiple specs can each have their own "before" without colliding. Existing files with the same name are overwritten — caller-controlled.

Recording is opt-in evidence: the same spec can be run multiple times with different labels for paired before/after videos around a bug fix.

## Phase 1 — Load the route's reference

Read the appropriate reference file:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/skills/forge/references/<reference>.md
```

Where `<reference>` is one of:
- `team-task.md` (for task/spec routes — carries `MODE` into its instructions)
- `init.md` (for init route)
- `export.md` (for export route)
- `run.md` (for run route — carries `RECORD_AS` into its instructions)

Then **follow the instructions in the loaded reference**. The reference is the authoritative body for that route; this SKILL.md just got you to the right one.

When passing context into the reference's work, include the captured route-specific values:

- For team-task: `MODE` and the task description (args with route keyword stripped).
- For init: optional target directory.
- For export: spec name + optional `--output <path>` override.
- For run: spec reference (explicit name / `last` / `latest` / unspecified) + `RECORD_AS`.

## Hard rules

- **You are a router.** Don't attempt to do the route's work from this SKILL.md — load the reference first. The references are where the actual instructions live.
- **Only load one reference per invocation.** Don't pull in references for routes you didn't dispatch to.
- **Route keyword recognition is case-insensitive but exact-match on the first word.** `Init` matches `init`. `spec-fixup` does NOT match the `spec` route (it's a fresh task with the word "spec" in it — natural-language detection in phase 0a may still pull it into spec mode, that's fine).
- **If the user's input is ambiguous about which route they want, ask via AskUserQuestion** rather than guessing. The four routes are distinct enough that the user should be definitive.

## What this skill DOES do

Five routes unified under `/forge`:

- **Drive mode** (`/forge <task>`) — default. Spawns driver + snippet-author teammates. Driver scans the snippet library and invokes matching snippets; snippet-author writes snippets for novel work. Fastest path; no spec artifact.
- **Spec mode** (`/forge spec <task>` or natural-language signals) — adds spec-writer + spec-verifier. Composes a self-contained `.spec.ts`, runs it from cold start against the still-warm slot to verify it passes. No video recorded — recording is a separate concern, see `/forge run`.
- **Run** (`/forge run <spec-name | last | latest>`) — re-runs an existing verified spec via `forge-pool-run-spec.mjs`. Optional `record as <label>` produces a video at `forge/videos/<spec>-<label>.webm`. Useful for paired before/after evidence around a fix.
- **Init** (`/forge init [target-dir]`) — scaffolds the forge/ directory convention. Idempotent.
- **Export** (`/forge export <spec-name>`) — inlines a composed spec for shipping outside forge/.

For full details on each, follow the reference file the router loads.
