# /forge — team-task spec-mode addendum

This file is loaded by the team-lead **only** when `MODE=spec`. Sections below are additions to or modifications of the base `team-task.md` — integrate them inline at the indicated phases.

The base file covers drive mode (lead + driver + snippet-author). Spec mode adds two more teammates (`spec-writer`, `spec-verifier`), four total completion pings instead of two, and a verified-spec line in the final report.

Lifecycle table override (use this when MODE=spec):

| Step | spec mode |
|---|---|
| Tasks created in phase 2.1 | 4 (driver, snippet-author, spec-writer, spec-verifier) |
| Teammates spawned in phase 3 | driver, snippet-author, spec-writer, spec-verifier |
| Completion pings to wait for in phase 4 | 4 |
| Final report | "drove the task + verified spec" |

## Phase 2.1 addition — also create spec tasks

After creating the driver + snippet-author tasks from the base file, also create:

```
TaskCreate(
  subject="spec-writer: produce self-contained spec from drive",
  description="Wait for driver's final-state summary at end of drive. Compose a self-contained .spec.ts in <FORGE_ROOT>/specs/ that reproduces the user task: import + compose snippets for invoked steps, inline code for fresh-drive steps, assert on captured values. Spec must be runnable from cold start. SendMessage `spec-verifier` the spec path when done. Claim with TaskUpdate(status='in_progress') at start and TaskUpdate(status='completed') when the spec is written and handed off."
)
# Note as SPEC_WRITER_TASK_ID.

TaskCreate(
  subject="spec-verifier: run spec from a cold context, confirm it passes",
  description="Wait for spec-writer's 'spec ready' message. Run the spec via `forge-run-spec.mjs --spec <path>`. Mirror the drive's conditions: fresh browser context, env loaded via forge.md's recipe if it has one (same prefix the driver used). On pass: ping team-lead with verified-from-fresh status. On fail: SendMessage driver (selectors) or spec-writer (assertions/imports) for clarification, iterate up to 3 times, then either succeed or escalate. Claim with TaskUpdate(status='in_progress') at start and TaskUpdate(status='completed') when verification finishes (pass or escalation)."
)
# Note as SPEC_VERIFIER_TASK_ID.
```

## Phase 3.0 — Load spec-mode agent addenda

Drive spawns send agents lean prompts; spec mode adds protocol that lives in separate addendum files (one per agent) so it only loads when needed. Before spawning, read both addenda:

```bash
cat <PLUGIN_ROOT>/skills/forge/references/spec-addenda/driver.md
cat <PLUGIN_ROOT>/skills/forge/references/spec-addenda/snippet-author.md
```

Capture each as `DRIVER_SPEC_ADDENDUM` and `AUTHOR_SPEC_ADDENDUM`. Inline them into the driver and snippet-author spawn prompts (the base file's 3.1 and 3.2 each show the conditional `SPEC MODE ADDENDUM:` block).

## Phase 3.3 — Spawn the spec-writer

```
Agent(
  description="Compose spec",
  subagent_type="forge:spec-writer",
  name="spec-writer",
  prompt="PROJECT_FORGE_ROOT: <FORGE_ROOT>
USER_TASK: <user's task verbatim>

Your task ID is <SPEC_WRITER_TASK_ID>. As your first action, claim it by calling `TaskUpdate(taskId=<SPEC_WRITER_TASK_ID>, status='in_progress')`. Then read your hints (forge.md + spec-writer.md from <FORGE_ROOT>/hints/) and wait for BOTH the driver's final-state message AND snippet-author's 'snippets ready' message before composing. When the spec is written and handed off to spec-verifier (if present), call `TaskUpdate(taskId=<SPEC_WRITER_TASK_ID>, status='completed')` before pinging team-lead."
)
```

## Phase 3.4 — Spawn the spec-verifier

```
Agent(
  description="Verify spec from cold",
  subagent_type="forge:spec-verifier",
  name="spec-verifier",
  prompt="PROJECT_FORGE_ROOT: <FORGE_ROOT>
PLUGIN_ROOT: <PLUGIN_ROOT>
USER_TASK: <user's task verbatim>

Your task ID is <SPEC_VERIFIER_TASK_ID>. As your first action, claim it by calling `TaskUpdate(taskId=<SPEC_VERIFIER_TASK_ID>, status='in_progress')`. Then read your hints (forge.md + spec-verifier.md from <FORGE_ROOT>/hints/) and wait for spec-writer's 'spec ready' message. When verification finishes (pass or 3-iteration escalation), call `TaskUpdate(taskId=<SPEC_VERIFIER_TASK_ID>, status='completed')` before pinging team-lead."
)
```

## Phase 4 addition — expect 4 completion pings

In spec mode you wait for 4 pings (driver + snippet-author + spec-writer + spec-verifier) before proceeding to phase 5. Natural order: driver/snippet-author → spec-writer → spec-verifier. The base file's idle-watchdog and STUCK protocol apply unchanged.

## Phase 5.5 — Spec-mode final-report shape

Override the base file's drive-mode report with the spec-mode version:

> <driver's final-result one-liner>
>
> Snippet-author wrote N snippet(s):
>   - <name1> — <description>
> (or: "Snippet-author wrote 0 snippets — drive's work was covered by existing library.")
>
> Spec-writer wrote `<name>.spec.ts` composing <list of snippets> and asserting <one-liner>.
> (or: "Spec-writer updated `<name>.spec.ts` in place" / "No new spec — existing one covers this.")
>
> Spec-verifier ran `<name>.spec.ts` — **passed** in <duration>.
> (or: "Spec-verifier ran spec, FAILED after 3 iterations — escalated. See <details>.")
>
> Hint files updated: <one line per file with summary>.
> (Omit this header entirely if no proposals were surfaced or all were rejected.)
>
> Slot released.

If anything didn't go to plan (spec-verifier escalated, snippet invocation failed mid-drive, etc.), surface prominently.
