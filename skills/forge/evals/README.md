# /forge evals

Regression coverage for `/forge` prompt edits, in [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) format.

One `evals.json`, 24 auto-runnable cases. Each case checks observable behaviour — routing decisions or script-invocation effects — without depending on what was already in the sandbox before the case ran.

## Design principle: stateless + parallel-safe

The suite tests **decisions and side-effects of script invocations**, not full team execution. Two reasons:

- **Routing tests** check Phase 0 / 0a / 0b dispatch. The subagent reads `SKILL.md`, applies the routing rules to a prompt, outputs a JSON decision, and stops. No team spawned.
- **Script tests** check `/forge run` and `/forge export`. These routes don't claim slots and don't spawn teammates — they invoke `forge-pool-run-spec.mjs` / `forge-export-spec.mjs` directly. The subagent invokes the skill end-to-end and we check the resulting artifacts.

Both kinds of test are stateless and parallel-safe. The suite can re-run across iterations without sandbox reset.

## Running

```
/skill-creator run the evals at plugins/forge/skills/forge/evals/evals.json against the /forge skill at plugins/forge/skills/forge/
```

That's it. One file, one invocation.

**Skip the without-skill baseline.** Skill-creator's canonical pattern spawns two subagents per case — one with the skill, one without — to measure the delta. Don't do this for forge. The prompts explicitly say "Read the SKILL.md at the skill path"; without a path the baseline subagent has nothing to read and every assertion fails by construction. The delta becomes a tautology, not signal. Spawn `with_skill` only.

## What's covered (24 cases)

| Category | Cases | What's tested |
|---|---|---|
| `route-*` | 9 | `/forge init`, `/forge export`, `/forge run` — explicit keyword + natural-language variants |
| `mode-*` | 6 | Drive vs spec mode selection, including negative cases for incidental "spec" or "record" keyword mentions |
| `label-*` | 3 | Recording-label parsing (`record as 'X'`, `record a X video`, `label it X`) |
| `case-insensitive` | 1 | `/Forge INIT` → init (case-insensitive first-word match) |
| `run-*` | 3 | `/forge run` script invocation: verification-only, with `record as <label>`, with `last` resolution |
| `export-*` | 2 | `/forge export` script invocation: default output path, `--output` override |

Three cases marked **PENDING** in their `expected_output` test desired natural-language detection for init/export routes that Phase 0 doesn't yet support. They fail today; will turn green when Phase 0 is expanded. TDD spec for that follow-up.

## What's deliberately NOT in the suite

**Full spec-mode end-to-end** (`/forge spec <task>` with the team actually running) cannot be tested from a nested skill-eval subagent — the agent-teams primitive (`TeamCreate`, `Agent`, `SendMessage`) only exists in the top-level Claude Code session. The constraint is a Claude Code platform property, not a forge limitation.

In practice this is fine: you exercise the happy path **ad hoc, manually**, by invoking `/forge spec <task>` at the top level when you've made changes to the team agents (driver / snippet-author / spec-writer / spec-verifier) or to `references/team-task.md`. Any concrete site works as the testbed — saucedemo via `~/repos/forge-tests/`, EventsAir, anything you have access to. No runbook needed; the assertions are what a developer would check by eye anyway.

**State-sensitive checks** also stay manual:

- Snippet authoring discipline (does snippet-author write when work is novel?)
- Library reuse discipline (does driver invoke vs re-drive?)
- Spec-writer skip-when-match (does it correctly skip when an exact-match spec exists?)

These behaviours depend on what's already in `forge/snippets/` and `forge/specs/`. Automating them means controlling that pre-state, which costs more than it gives in regression signal. Eyeball them when you've changed something that could plausibly affect the behaviour.

## Adding cases

Append to `evals.json`'s `evals` array. Each case needs:

- `id` (next integer)
- `name` (descriptive, kebab-case, prefixed with the category — `route-` / `mode-` / `label-` / `run-` / `export-` / etc.)
- `prompt` — for routing-decision cases, embed the routing-wrapper instruction (read SKILL.md, output JSON describing the routing decision). For script-execution cases, the user's actual `/forge` invocation.
- `expected_output` — human-readable success description. Flag `PENDING` if the case is TDD-style and currently fails.
- `files` — input files (empty for almost all forge cases)
- `expectations` — list of programmatically-verifiable statements

When in doubt about whether a check belongs in evals or in manual testing: if the assertion would behave differently depending on what was already in the sandbox before this case ran, it's state-sensitive — move it to manual testing.

See `schemas.md` in skill-creator's references directory for the canonical schema.
