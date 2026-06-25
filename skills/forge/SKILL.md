---
name: forge
description: "Browser-automation agent team for Claude Code. Seven routes under one skill: `/forge init` (scaffold the forge/ directory convention in CWD), `/forge <task>` (drive mode — a single worker drives the task and accretes snippets), `/forge spec <task>` (spec mode — the worker also composes and verifies a Playwright spec from the drive's own trace), `/forge teach <topic>` (teach mode — user pilots forge turn-by-turn to curate snippets with project-specific gotchas baked in), `/forge run <spec>` (re-run a verified spec, optionally recording a video for evidence), `/forge export <name>` (inline a composed spec for shipping outside forge/), `/forge clean [snippets|hints|both]` (scan the snippet library and hint files for accumulation and surface cleanup candidates). Each invocation launches a fresh chromium session, runs the user's task, and cleans up. Project-specific conventions (test accounts, env handling, setup/teardown) live in hints/forge.md; forge stays project-agnostic."
model: sonnet
argument-hint: "[spec|run|init|export|clean] <args>"
allowed-tools: Read, Edit, Write, Glob, Skill, AskUserQuestion, Bash(node **/forge/scripts/*), Bash(direnv:*), Bash(playwright-cli:*), Bash(mkdir:*), Bash(cat:*), Bash(echo:*), Bash(ls:*), Agent, SendMessage, TaskCreate, TaskList, TaskGet, TaskUpdate
---

# /forge

`/forge` is a single skill with seven routes (init, export, run, teach, spec, clean, and the default task route). This SKILL.md is a thin router — it parses the route, captures route-specific context, and dispatches to a reference file. Only the chosen route's reference is loaded.

## Phase 0 — Pick the route

First word of `$ARGUMENTS` (case-insensitive). Dispatch table:

| First word | Route | Loaded reference | Rest of args becomes |
|---|---|---|---|
| `init` | scaffold a forge/ directory | `references/init.md` | optional target dir |
| `export` | inline a composed spec for shipping | `references/export.md` | spec name + optional `--output <path>` |
| `run` | re-run a verified spec, optionally recording | `references/run.md` | spec name / `last` / `latest`, plus optional `record as <label>` |
| `teach` | teach mode — user pilots forge to curate snippets | `references/teach.md` | optional session-framing topic |
| `clean` | tidy snippet library + hint files | `references/clean.md` | optional scope: `snippets` \| `hints` \| `both` |
| `spec` | spec mode — drive + write spec + verify (intent: regression / red-green bug repro / assertion-less scenario) | `references/team-task.md` + `references/team-task-spec.md` (with `MODE=spec`) | the actual task description |
| *(anything else)* | (see natural-language signals below; default fallback is the task route) | `references/team-task.md` (with `MODE=drive`) | the full args = task description |

### Natural-language route signals (when first word doesn't match)

When the first word isn't a route keyword, check the full args for these phrasings before falling through to the task route. The phrase has to genuinely express the route's intent — a single keyword in passing isn't enough.

**Init route** — an init-verb combined with `forge` as the object:

- "install forge here" / "install forge in this project"
- "scaffold forge" / "scaffold forge here" / "scaffold the forge directory"
- "set up forge" / "set up forge in this project"
- "initialise forge" / "initialize forge"

**Export route** — an export-verb combined with a spec reference:

- "ship this spec" / "ship the spec for the team" / "ship that spec"
- "inline this spec" / "inline the snippets in <name>"
- "export the spec from the latest recording" *(also matches the first-word `export` keyword — the NL pattern is redundant-safe)*

**Teach route** — a teach-verb combined with forge/snippets as the object, OR an offer-to-pilot phrasing:

- "teach forge how to log in" / "teach forge to create an event"
- "let me show forge how to ..." / "let me walk forge through ..."
- "I want to teach forge ..." / "I'll pilot forge to capture ..."
- "show forge how to ..." (intent must clearly be capturing a reusable snippet, not just running the action once)

**Clean route** — a tidy/audit-verb combined with the snippet library or hint files as the object:

- "tidy up the snippet library" / "tidy up forge's snippets"
- "review hint accumulation" / "review the hint files for cruft"
- "what's gotten stale in forge?" / "audit the snippet library"
- "clean up forge's hints" / "prune the snippet library"
- "scan for cleanup candidates in forge"

Scope inference when the NL signal matches but doesn't specify: phrasing names snippets only → `snippets`; names hints only → `hints`; ambiguous or names both → `both`.

If a natural-language signal matches, set the route and pass the full args (the reference handles parsing).

If neither first-word nor natural-language matches, the route stays task and Phase 0a applies.

Counter-examples that should NOT match:

- "log in and ship the package to checkout" — "ship" appears but not paired with `spec`
- "install the user via this API" — "install" appears but not paired with `forge`
- "spec the backpack feature out for me" — colloquial "spec" with no authoring intent (Phase 0a's spec-mode detection would also reject this)
- "teach me how to write a Playwright test" — teaching intent is about the user being taught, not forge being taught
- "show me the login flow" — "show" appears, but the object is the user, not forge

### Examples

- `/forge init` → route=init, args=""
- `/forge init ~/my-project` → route=init, args="~/my-project"
- `/forge install forge here` → route=init (via NL signal), args="install forge here"
- `/forge export add-backpack-to-cart-standard` → route=export, args="add-backpack-to-cart-standard"
- `/forge ship this spec for the team` → route=export (via NL signal), args="ship this spec for the team"
- `/forge run last spec, record as before` → route=run, args="last spec, record as before", RECORD_AS=before
- `/forge teach login flow` → route=teach, args="login flow"
- `/forge teach forge how to create an event` → route=teach, args="forge how to create an event"
- `/forge let me show forge how to log in` → route=teach (via NL signal), args="let me show forge how to log in"
- `/forge clean` → route=clean, args="" (scope defaults to both)
- `/forge clean snippets` → route=clean, args="snippets"
- `/forge tidy up the snippet library` → route=clean (via NL signal), args="tidy up the snippet library", scope=snippets
- `/forge spec PROJ-123 add a backpack` → route=spec, args="PROJ-123 add a backpack", MODE=spec
- `/forge add the backpack to cart` → route=task, args="add the backpack to cart", MODE=drive
- `/forge create a spec for adding the backpack` → route=task, args="create a spec for adding the backpack", MODE=spec (via Phase 0a natural-language signal)

## Phase 0a — Mode detection (task/spec route only)

For task and spec routes, set `MODE` before loading the reference. Skip for init / export / run / teach.

**MODE selection** — spec mode is selected when:

- Phase 0 already set `MODE=spec` because the first word was `spec`, OR
- The task description contains clear spec-authoring intent: "create a spec", "write a spec", "spec for AE-XXXX", "produce a spec that…", "capture this as a spec", "build a verification spec". Use judgment — phrases that genuinely ask for a spec artifact, not incidental mentions ("the spec is already correct, just drive…").

Otherwise → **drive mode**. If intent is ambiguous, default to drive — spec creation is an explicit opt-in.

Within spec mode, the spec carries a mandatory **intent** — regression (assert correct behavior, expect green), repro (red-green bug reproduction: assert correct behavior, expect red until the bug is fixed), or scenario (no assertions, re-run via `/forge run`). A bug ticket / "reproduce …" / "failing spec for …" signals repro; the lead establishes and (when ambiguous) confirms the intent before authoring — see `team-task-spec.md` Phase 2.0.

## Phase 0b — Recording label detection (run route only)

For the run route, look for a recording label in the args:

- "record as 'before'" / "record this as after" / "label it before-fix" → `RECORD_AS = before` / `after` / `before-fix`
- "record a before video" → `RECORD_AS = before` (extract the adjective)
- No mention → `RECORD_AS = none` — verification-only, no video

Persisted recording filename: `<spec-basename>-<suffix>.webm` under `forge/videos/`. Suffix is the user-supplied label or a timestamp default. Spec context stays attached so multiple specs can each have their own "before" without colliding. Existing files with the same name are overwritten — caller-controlled.

Recording is opt-in evidence: the same spec can be run multiple times with different labels for paired before/after videos around a bug fix.

## Phase 1 — Capture `PLUGIN_ROOT`, then load the route's reference

### 1.0. Capture `PLUGIN_ROOT`

The harness substitutes `${CLAUDE_PLUGIN_ROOT}` in this SKILL.md before Claude reads it, but **not** in content loaded dynamically via `cat` at runtime (i.e. the reference files). References can't reliably use `${CLAUDE_PLUGIN_ROOT}` directly — by the time bash sees the command, the env var isn't expanded.

The substituted value of `${CLAUDE_PLUGIN_ROOT}` in this paragraph is the literal path to use:

```
${CLAUDE_PLUGIN_ROOT}
```

Capture that exact path string as `PLUGIN_ROOT`. Substitute it for every `<PLUGIN_ROOT>` placeholder in references and spawn prompts. Do **not** try to re-derive the path via bash env-var lookup, filesystem search, or `find` — those routes pick up stale installs (e.g., a marketplace copy alongside a `--plugin-dir` install) and silently use the wrong version.

If the path above shows the literal `${CLAUDE_PLUGIN_ROOT}` (unsubstituted), forge can't proceed. Surface to the user:

> The plugin harness didn't substitute `${CLAUDE_PLUGIN_ROOT}` in SKILL.md, which forge needs to locate its scripts. This usually means the plugin isn't loaded correctly — re-install or re-load with `--plugin-dir <path>`, then re-invoke `/forge`.

Then stop.

### 1.1. Read the reference

```bash
cat <PLUGIN_ROOT>/skills/forge/references/<reference>.md
```

(Substitute the literal value captured in 1.0 for `<PLUGIN_ROOT>`.)

Where `<reference>` is one of:
- `team-task.md` (for task/spec routes — carries `MODE` into its instructions). In spec mode, also load `team-task-spec.md` after it — the addendum carries the Phase 2.0 spec-intent decision and the spec-mode final-report shape.
- `teach.md` (for teach route — carries the optional session-framing topic)
- `init.md` (for init route)
- `export.md` (for export route)
- `run.md` (for run route — carries `RECORD_AS` into its instructions)
- `clean.md` (for clean route — carries the optional scope `snippets|hints|both`)

Then **follow the instructions in the loaded reference** — it's authoritative for that route.

When passing context into the reference's work, include the captured route-specific values AND the resolved `PLUGIN_ROOT`. References use `<PLUGIN_ROOT>` as a placeholder; substitute the captured value when running their bash commands.

- For all routes: `PLUGIN_ROOT` (the literal path captured in 1.0).
- For team-task: `MODE` and the task description (args with route keyword stripped).
- For teach: the optional session-framing topic (may be empty).
- For init: optional target directory.
- For export: spec name + optional `--output <path>` override.
- For run: spec reference (explicit name / `last` / `latest` / unspecified) + `RECORD_AS`.
- For clean: the optional scope (default `both`).

## Hard rules

- **You are a router.** Don't do the route's work from this SKILL.md — load the reference first.
- **Only load the route's reference(s).** The spec route legitimately loads two: `team-task.md` + `team-task-spec.md`. Every other route loads one.
- **Route keyword recognition is case-insensitive but exact-match on the first word.** `Init` matches `init`. `spec-fixup` does NOT match the `spec` route (Phase 0a's natural-language detection may still pull it into spec mode, that's fine).
- **If the user's input is ambiguous about which route they want, ask via AskUserQuestion** rather than guessing.

