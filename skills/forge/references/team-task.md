# /forge — team-task reference (base, drive mode)

This reference is loaded by `/forge`'s router for the **task** and **spec** routes. The router has already:

- Decided `MODE` (one of `drive` | `spec`)
- Stripped any leading `spec` keyword from the task description
- Resolved `PLUGIN_ROOT` to the plugin's install path (see SKILL.md phase 1.0)

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below is a placeholder — substitute the literal path captured by the router. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in the bash context that runs from this reference.

**If `MODE=spec`, also load `references/team-task-spec.md`** — it adds spec-intent establishment, threads `SPEC_INTENT` into the worker spawn, and gives the spec-mode report shape. Otherwise skip; this base file is sufficient for drive mode.

Below is the full lifecycle for running the forge **worker** — a single teammate — against an ephemeral chromium session. You are the **team lead**: you manage lifecycle (session creation, task coordination, shutdown, cleanup) and own the **user channel**. The worker does the actual work (drive, author snippets, and in spec mode compose + verify + fix) in its own context. Your job is setup, lifecycle, and relaying between the user and the worker.

Drive-mode lifecycle at a glance:

| Step | drive mode |
|---|---|
| Tasks created in phase 2.1 | 1 (worker) |
| Teammates spawned in phase 3 | 1 (worker) |
| Completion pings to wait for in phase 4 | 1 |
| Final report | "drove the task" |

Spec mode threads a spec intent and extends the final report — see the spec addendum. The worker count stays **one** in both modes.

## Prerequisite

The forge worker runs as a **teammate** (not a backgrounded sub-agent) so the main conversation stays interactive and you can relay the user's mid-run steering to it. That requires agent teams, gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. When the flag isn't set, the first `Agent(...)` call below will fail with an explicit message. Relay the remedy to the user:

> /forge requires experimental agent teams. Enable by adding `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` to `~/.claude/settings.json` (or set the env var in your shell) and restart Claude Code.

Then stop.

The team auto-forms when the worker spawns — no `TeamCreate` call needed, no separate cleanup step. The team directories at `~/.claude/teams/session-<8-char>/` and `~/.claude/tasks/session-<8-char>/` are created automatically and the team config is removed on session exit. The task list persists until `cleanupPeriodDays` elapses. It's a team of one — the infrastructure is what keeps you non-blocked and lets you message the running worker; the single-worker shape is what keeps the drive's verbatim trace in one context.

## Phase 1 — Discovery and setup

### 1.1. Find the project's forge root

```bash
node <PLUGIN_ROOT>/scripts/forge-find-root.mjs
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge init`.

Capture as `FORGE_ROOT`.

### 1.2. Load the forge.md hint (lead-only)

```bash
cat <FORGE_ROOT>/hints/forge.md 2>/dev/null || echo ""
```

You need `forge.md` for persona/account resolution and the optional setup/teardown sections in Phases 1.4 and 5.3. The other hint files (`driver.md`, `snippet-author.md`, `spec-writer.md`, `spec-verifier.md`) are read by the worker itself — you don't carry them. Empty string is fine; the worker falls back to defaults.

All hints are optional. A bare `/forge init` scaffold drives correctly; hints encode project-specific knowledge the worker can't derive from the app itself.

### 1.3. Generate a session name

Forge runs are stateless — each invocation gets its own chromium with a fresh, ephemeral profile. Generate a unique playwright-cli session name:

```bash
echo "ft-$(node -e 'console.log(require("crypto").randomBytes(4).toString("hex"))')"
```

Capture as `SESSION_NAME`. The worker uses it to launch/reference the browser; phase 5 uses it to close it.

### 1.3a. Check cleanup staleness (silent — surface at end)

Read `<FORGE_ROOT>/.last-cleanup` if it exists:

```bash
cat <FORGE_ROOT>/.last-cleanup 2>/dev/null || echo ""
```

JSON of the form `{ "hints": "<ISO timestamp>", "snippets": "<ISO timestamp>" }`. Compute days-since for each key.

Capture `CLEANUP_NUDGE` as one of:

- **empty** if the file doesn't exist and both `forge/hints/` and `forge/snippets/` are sparse (under ~3 files combined).
- **`hints` / `snippets` / `both`** if the file is missing on a non-sparse project, or the corresponding timestamp is older than 7 days.

Hold for Phase 5.5. **Do not surface now** — maintenance nudges at task start fight the user's actual intent. Surface at end-of-run as a one-line tail.

### 1.4. Apply setup instructions (optional)

If `forge.md` has a `## Setup before each run` section, follow it literally. Examples: SQL seeding, account-reset endpoint, mint a fresh test user, "don't reset anything."

If absent, skip — each session's chromium profile is fresh.

If setup captures values (e.g. minted credentials), hold them in your context — pass to the worker via spawn prompt or append to the env contract in `forge.md`.

If setup fails, surface to the user and stop.

## Phase 2 — Create the task

The team auto-forms when the worker spawns in Phase 3 — no setup call. Skip straight to task creation.

### 2.1. Create the worker task

```
TaskCreate(
  subject="forge worker: <USER_TASK>",
  description="Drive the user's browser task end-to-end using playwright-cli session <SESSION_NAME>, scanning <FORGE_ROOT>/snippets/ first and invoking matching snippets. Author snippets from the fresh-drive steps with hindsight. MODE=<MODE>: in spec mode, also compose a self-contained .spec.ts in <FORGE_ROOT>/specs/ from the drive's own verbatim trace, run it cold via forge-run-spec.mjs, and self-fix until it matches SPEC_INTENT. Claim with TaskUpdate(status='in_progress') at start; keep it in_progress across the whole run (including the spec verify loop); TaskUpdate(status='completed') at the final report. Escalate to team-lead via SendMessage when blocked; then ping team-lead and go idle."
)
# Note the task ID returned — call it WORKER_TASK_ID.
```

Don't set ownership in TaskCreate — the worker self-claims by calling `TaskUpdate(taskId=<id>, status="in_progress")`. The spawn prompt names the task ID so the worker knows which to claim.

**If MODE == spec**, establish the spec intent first — see `team-task-spec.md` Phase 2.0 (it may ask the user via `AskUserQuestion`). Capture `SPEC_INTENT` for the spawn prompt below.

## Phase 3 — Spawn the worker

Spawn one worker as a **teammate** — no `run_in_background`. Being a teammate already keeps the main thread non-blocked and reachable for mid-run steering; backgrounding would downgrade it to a fire-and-forget sub-agent and (under `teammateMode: auto`) cost you the per-teammate pane you watch it in.

```
Agent(
  description="Forge <MODE>: <short USER_TASK>",
  subagent_type="forge:worker",
  name="worker",
  prompt="MODE: <MODE>
SESSION_NAME: <SESSION_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
USER_TASK: <user's task verbatim>
<if MODE == spec, include:> SPEC_INTENT: <regression | repro | scenario>
<for repro, also include the bug claim(s) to assert as correct behavior>

Your task ID is <WORKER_TASK_ID>. As your first action, claim it by calling `TaskUpdate(taskId=<WORKER_TASK_ID>, status='in_progress')`. Then read your hints (forge.md + the role hints for your mode from <FORGE_ROOT>/hints/) and begin. When the whole run is finished, call `TaskUpdate(taskId=<WORKER_TASK_ID>, status='completed')` before pinging team-lead."
)
```

`description` is required by the Agent tool — keep it short.

## Phase 4 — Wait for the worker, relay the user

After spawning, the worker self-coordinates. You wait and stay available to the user.

**What to watch for:**

- **The worker's completion ping** — primary signal it's done. The worker SendMessages `team-lead` with `Worker task <id> complete`. Proceed to phase 5 on this ping.
- **Messages addressed to you (`team-lead`)** — process them:
  - **STUCK from the worker** — plain text with `STUCK` as first line, then `QUESTION:`, `CONTEXT:`, optionally `OPTIONS:` (`- <label> | value: <value>`). Surface via `AskUserQuestion`:
    - Build the question from `QUESTION:`. Parse `OPTIONS:` lines to AskUserQuestion options (label as option label, remember value for relay). AskUserQuestion always allows "Other". If no `OPTIONS:`, ask open-ended.
    - On user response, `SendMessage` the worker with summary `stuck_response` and body `stuck_response — answer: <chosen-value-or-free-text>`.
    - The run is paused while waiting for the user; it resumes on relay.
  - **`cannot-drive` from the worker** — terminal failure. Surface in the final report; proceed to phase 5 cleanup.
  - **Status updates / questions** — answer concisely or relay context.
- **The user speaks to you mid-run** — this is the interjection path the team-of-one shape exists for. When the user steers ("that selector's wrong", "skip the newsletter modal", "actually assert the total too"), relay it to the worker: `SendMessage(to="worker", summary="steer", message="<the user's instruction, verbatim or lightly framed>")`. The worker folds it into what it's doing. Don't queue it silently — relay promptly so it lands at the worker's next turn boundary.
- **Idle notifications** — informational only; they fire after every turn including ones still working. Treat `task <id> complete` as authoritative — not idle notifications.

> **Note on `TaskList()`:** calling `TaskList` from the lead session does NOT surface team tasks reliably — completed tasks often report as `No tasks found`. Treat the worker's ping as authoritative; don't gate phase 5 on TaskList.

### 4.1. Idle-notification stall watchdog

A worker that finished but forgot to ping appears as a stream of idle notifications with no completion summary. Don't wait indefinitely. Keep a counter of consecutive idle notifications with no progress; a notification carrying a peer-DM summary counts as progress and resets it, a bare `idleReason: available` increments it.

When the counter reaches 3, nudge once:

```
SendMessage(
  to="worker",
  summary="status check",
  message="What's your status — done? If finished, please SendMessage team-lead with a completion summary so we can proceed to shutdown."
)
```

If the worker responds with a completion summary, treat it as the missing ping. If 2 more idle notifications arrive after the nudge with no response, the worker is stuck or exited uncleanly. Inspect on-disk artifacts (`ls <FORGE_ROOT>/snippets/`, `ls <FORGE_ROOT>/specs/`), surface state to the user, and skip to phase 5.4 (close the chromium session). The harness cleans up the team directories on session exit — no manual `rm -rf` needed.

**Bounded waiting**: if 10+ minutes pass without the completion ping AND no STUCK / cannot-drive escalation, surface to the user and prepare for force-cleanup.

## Phase 4.5 — Review hint proposals (on-demand)

The worker's completion ping ends with `proposals: <N>`:

- `proposals: 0` — nothing to wait for. **Skip this phase entirely** and proceed to Phase 5. Don't load the proposal-review reference; don't surface "no proposals". Silence is the right outcome.
- `proposals: <N>` where `N > 0` — wait for a separate `PROPOSALS` SendMessage, then:

  1. Capture the body verbatim.
  2. Load the proposal-review reference:

     ```bash
     cat <PLUGIN_ROOT>/skills/forge/references/proposal-review.md
     ```

  3. Follow its instructions for aggregation, user review, and application.
  4. Hold its "Hint files updated" summary for Phase 5.5's final report.

On-demand loading keeps the lead's prompt lean on happy-path runs.

## Phase 5 — Shut down and clean up

Once the worker's completion ping has arrived:

### 5.1. Request shutdown

```
SendMessage(
  to="worker",
  summary="team work complete; shutdown",
  message={"type": "shutdown_request", "reason": "team work done"}
)
```

Wait for the `{"type": "shutdown_response", "approve": true, ...}`. The response includes a `paneId` (e.g. `"%105"`) when the backend is tmux — capture for pane cleanup. If the worker rejects with `approve: false`, surface the reason to the user.

The team's shared directories are removed automatically when the session exits — no explicit cleanup call.

### 5.2. Kill the leftover tmux pane

Claude sessions exit cleanly on shutdown_approved, but tmux keeps the pane open with the shell underneath and the agent-set title applied. Clean up using the `paneId` from the `shutdown_response`:

```bash
tmux kill-pane -t <paneId>
```

Best-effort — `tmux kill-pane` failures (pane already gone) should not block cleanup. Skip if the backend wasn't tmux (no `paneId` in the response).

### 5.3. Apply teardown instructions (optional)

Look for a `## Teardown after each run` section in `forge.md`. If present, execute its instructions (SQL queries, endpoint calls, etc.). If absent, skip.

### 5.4. Close the chromium session

```bash
playwright-cli -s=<SESSION_NAME> close
```

Best-effort. If it errors or chromium survives, fall back to killing the process tree. The worker may have already closed it — the call is a no-op then.

### 5.5. Report to the user

Compose a tight summary. Drive-mode shape:

> <worker's final-result one-liner>
>
> Snippets: wrote N (<names>) — or "none — drive's work was covered by existing library".
>
> Hint files updated: <one line per file with summary, e.g. "forge/hints/driver.md (+2 sections)">.
> (Omit this header entirely if no proposals were surfaced or all were rejected.)
>
> Browser session closed.

In spec mode, use the extended shape in `team-task-spec.md` Phase 5.5 — it adds the spec + verification line.

If anything didn't go to plan (the worker returned `cannot-drive`, a spec parked unverified, snippet invocation failed mid-drive, etc.), surface prominently — the user wants the truth, not a sanitized success report.

### 5.5a. Append cleanup nudge (if captured in 1.3a)

If `CLEANUP_NUDGE` from Phase 1.3a is non-empty, append a one-line tail:

- `CLEANUP_NUDGE=hints` — *"Last hint cleanup was N days ago — consider `/forge clean hints` after this run."* (Use "never" if the staleness file didn't exist.)
- `CLEANUP_NUDGE=snippets` — *"Last snippet cleanup was N days ago — consider `/forge clean snippets` after this run."*
- `CLEANUP_NUDGE=both` — *"Hints and snippets haven't been cleaned in over a week — consider `/forge clean` after this run."* (Or, if the staleness file is missing entirely: *"No record of any forge cleanup — consider `/forge clean` to baseline."*)

Non-blocking and once-per-run. Don't surface mid-task; don't gate shutdown on it; don't repeat if the user already invoked clean this session.

## Hard rules

- **You are an orchestrator, not an actor.** All browser driving, snippet authoring, spec writing, and spec running belong to the `worker`. You set up the team, create the task, spawn the worker, manage the lifecycle, AND **handle the user channel**: STUCK messages → AskUserQuestion → SendMessage the answer back, and the user's mid-run steering → SendMessage relayed to the worker. You do NOT invoke `playwright-cli`/`forge-pw` yourself, write snippet or spec files, or run specs.
- **The verify loop lives inside the worker, not in you.** In spec mode the worker runs its spec cold, diagnoses failures, and self-fixes — because it holds the drive's verbatim trace. You don't triage failure classes or route fixes; you relay the user's steer and surface the worker's STUCK if it can't converge. This is the simplification the single-context design buys.
- **Relay, don't author.** When the user steers mid-run, pass it to the worker; don't act on it yourself.
- **Always close the chromium session.** Even if the worker returned `cannot-drive` or rejected shutdown, eventually call `playwright-cli -s=<SESSION_NAME> close`. Leaving chromium running wastes resources and (in single-session apps) blocks the next login.
- **One team per session, managed by the harness.** The team forms when the worker spawns and cleans up on session exit. No separate setup or teardown call.
- **`forge.md` is the source of truth for test-account / credential resolution.** When the user names an account, the worker reads `forge.md` to resolve it. Don't invent accounts; don't hardcode credentials.

## Failure modes to recover from

- **The `Agent(...)` call fails because experimental agent teams aren't enabled.** Surface the remedy from the Prerequisite section and stop.
- **Worker returns `cannot-drive` before doing meaningful work.** Surface it; proceed to cleanup.
- **The worker goes idle and never responds to your SendMessage.** May have errored mid-turn. Follow-up nudge (4.1). If still no response, surface to the user with the team's current state and proceed to close the session.
- **Credentials missing.** Worker reports STUCK because an env key expanded empty (e.g. `$ADMIN_USERNAME` not set). Surface the missing key to the user.
