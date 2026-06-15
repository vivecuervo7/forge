# /forge — team-task reference (drive + spec modes)

This reference is loaded by `/forge`'s router for **task** and **spec** routes. The router has already:

- Decided `MODE` (one of `drive` | `spec`)
- Stripped any leading `spec` keyword from the task description
- Resolved `PLUGIN_ROOT` to the plugin's install path (see SKILL.md phase 1.0)

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below is a placeholder — substitute the literal path captured by the router. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in the bash context that runs from this reference, and the placeholder pattern sidesteps that bug.

Below is the full lifecycle for running an agent team against an ephemeral chromium session. You are the **team lead**: you manage the team's lifecycle (session creation, team creation, task coordination, shutdown, cleanup) while teammates do the actual work via mesh communication. **You do not relay content between teammates — they SendMessage each other directly.** Your job is setup, lifecycle, and the user channel.

`MODE` shapes everything:

| Step | drive mode | spec mode |
|---|---|---|
| Tasks created in phase 2.3 | 2 (driver, snippet-author) | 4 (driver, snippet-author, spec-writer, spec-verifier) |
| Teammates spawned in phase 3 | driver, snippet-author | driver, snippet-author, spec-writer, spec-verifier |
| Completion pings to wait for in phase 4 | 2 | 4 |
| Final report | "drove the task" | "drove the task + verified spec" |

## Prerequisite

Agent teams are gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. If the `TeamCreate` tool isn't available in this session, surface this to the user with the remedy:

> /forge requires experimental agent teams. Enable by adding `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` to `~/.claude/settings.json` (or set the env var in your shell) and restart Claude Code.

Then stop.

## Phase 1 — Discovery and setup

### 1.1. Find the project's forge root

```bash
node <PLUGIN_ROOT>/scripts/forge-find-root.mjs
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge init`.

Capture as `FORGE_ROOT`.

### 1.2. Load the hints

```bash
cat <FORGE_ROOT>/hints/forge.md          2>/dev/null || echo ""
cat <FORGE_ROOT>/hints/driver.md         2>/dev/null || echo ""
cat <FORGE_ROOT>/hints/snippet-author.md 2>/dev/null || echo ""
cat <FORGE_ROOT>/hints/spec-writer.md    2>/dev/null || echo ""
cat <FORGE_ROOT>/hints/spec-verifier.md  2>/dev/null || echo ""
```

Capture each. Inline whatever you got in the spawn prompts so teammates don't need to read the files themselves. Empty string is fine — teammates fall back to their defaults.

All five hints are optional. A bare `/forge init` scaffold (no hint files authored) drives correctly; hints exist purely to encode project-specific knowledge that the agents can't derive from the app itself.

### 1.3. Generate a session name

Forge runs are stateless — each invocation gets its own chromium with a fresh, ephemeral profile. Generate a unique playwright-cli session name to reference throughout this run:

```bash
echo "ft-$(node -e 'console.log(require("crypto").randomBytes(4).toString("hex"))')"
```

Capture as `SESSION_NAME`. It's used by the driver to launch and reference the browser, and by phase 5 to close it cleanly at shutdown.

### 1.4. Apply setup instructions (optional)

If `forge.md` has a `## Setup before each run` (or similarly-named) section, follow it literally. The user writes it in their own words; treat it as instructions to you, not config. Examples: SQL seeding, account-reset endpoint, mint a fresh test user via API, "don't reset anything."

If `forge.md` is empty or has no setup section, skip — each session's chromium profile is fresh, so browser-side state starts clean without configuration.

If setup needs to capture values (e.g. a freshly-minted user's credentials), hold them in your context for the duration of the session — you'll pass them to the driver via the spawn prompt or by appending to the project's env contract documented in `forge.md`. The driver will then resolve credentials per the hint when invoking snippets that need them.

If setup fails (SQL error, endpoint timeout, etc.), surface to the user and stop — don't proceed with a half-initialized environment.

## Phase 2 — Create the team

### 2.1. Generate a team name

Use `forge-<run-id>` where `<run-id>` is a short identifier — derive from `SESSION_NAME` (already short and session-bound) plus the current timestamp's last 4 digits to avoid collisions across reclaims:

```bash
RUN_ID="${SESSION_NAME#ft-}-$(date +%s | tail -c 5)"
TEAM_NAME="forge-${RUN_ID}"
```

### 2.2. Create the team

Invoke `TeamCreate`:

```
TeamCreate(team_name="<TEAM_NAME>", description="Forge agent team for: <USER_TASK>")
```

This creates the team config at `~/.claude/teams/<TEAM_NAME>/config.json` and shared task list directory at `~/.claude/tasks/<TEAM_NAME>/`.

### 2.3. Create the tasks

Always create the driver + snippet-author tasks. Add the spec-writer + spec-verifier tasks **only in spec mode**.

```
TaskCreate(
  subject="drive: <USER_TASK>",
  description="Drive the user's browser task end-to-end using playwright-cli session <SESSION_NAME>. Scan <FORGE_ROOT>/snippets/ first and invoke matching snippets via forge-invoke-snippet.mjs instead of driving fresh. Narrate each step to `snippet-author` as 'invoked X' or 'drove fresh: X'. MODE=<MODE>: in spec mode, at end of drive, send `spec-writer` a final-state summary. In drive mode, no spec-writer to message — just ping team-lead and go idle. Mark complete when the drive is finished; stay idle (advisor phase) until shutdown."
)
# Note the task ID returned — call it DRIVE_TASK_ID.

TaskCreate(
  subject="snippet-author snippets from drive",
  description="Receive driver narration via SendMessage. Skip 'invoked' chunks (already in library). For 'drove fresh' chunks, decide which are snippet-worthy and write them to <FORGE_ROOT>/snippets/. Ask driver clarifying questions as needed. Mark complete when drive is done."
)
# Note as SNIPPET_AUTHOR_TASK_ID.
```

**If MODE == spec**, also create:

```
TaskCreate(
  subject="spec-writer: produce self-contained spec from drive",
  description="Wait for driver's final-state summary at end of drive. Compose a self-contained .spec.ts in <FORGE_ROOT>/specs/ that reproduces the user task: import + compose snippets for invoked steps, inline code for fresh-drive steps, assert on captured values. Spec must be runnable from cold start. SendMessage `spec-verifier` the spec path when done. Mark complete after."
)
# Note as SPEC_WRITER_TASK_ID.

TaskCreate(
  subject="spec-verifier: run spec from a cold context, confirm it passes",
  description="Wait for spec-writer's 'spec ready' message. Run the spec via `forge-run-spec.mjs --spec <path>`. Mirror the drive's conditions: fresh browser context, env loaded via forge.md's recipe if it has one (same prefix the driver used). On pass: ping team-lead with verified-from-fresh status. On fail: SendMessage driver (selectors) or spec-writer (assertions/imports) for clarification, iterate up to 3 times, then either succeed or escalate. Mark complete when done."
)
# Note as SPEC_VERIFIER_TASK_ID.
```

Don't set ownership in TaskCreate — teammates claim their own tasks.

## Phase 3 — Spawn the teammates

Always spawn driver + snippet-author. In spec mode, also spawn spec-writer + spec-verifier.

### 3.1. Spawn the driver

```
Agent(
  description="Drive <USER_TASK>",
  subagent_type="forge:driver",
  team_name="<TEAM_NAME>",
  name="driver",
  prompt="TEAM_NAME: <TEAM_NAME>
MODE: <MODE>
SPEC_WRITER_PRESENT: <yes if MODE=spec, else no>
SESSION_NAME: <SESSION_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
PROJECT_HINT_FORGE:
<forge.md contents>

PROJECT_HINT_DRIVER:
<driver.md contents, or 'none' if missing>

USER_TASK: <user's task verbatim>

Your task is referenced as ID <DRIVE_TASK_ID> for the team's records. Begin driving. The forge.md hint documents how this project describes its test accounts / credential scheme — read it and follow it when the user names an account or role. SendMessage `snippet-author` with structured summaries after meaningful steps. When SPEC_WRITER_PRESENT=yes, send `spec-writer` a final-state summary at end of drive. When SPEC_WRITER_PRESENT=no, skip that — just SendMessage `snippet-author` with summary='drive complete' and SendMessage team-lead. Then go idle — snippet-author may have follow-up questions."
)
```

`description` is required by the Agent tool — keep it short (a few words is enough; it's just a label for the spawned agent in transcripts).

### 3.2. Spawn the snippet-author

```
Agent(
  description="Author snippets",
  subagent_type="forge:snippet-author",
  team_name="<TEAM_NAME>",
  name="snippet-author",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
SPEC_WRITER_PRESENT: <yes if MODE=spec, else no>
USER_TASK: <user's task verbatim>
PROJECT_HINT_SNIPPET_AUTHOR:
<snippet-author.md contents, or 'none' if missing>

Your task is referenced as ID <SNIPPET_AUTHOR_TASK_ID> for the team's records. Wait for driver messages. Process messages as they arrive; write snippets to <FORGE_ROOT>/snippets/; SendMessage `driver` with clarifying questions if needed. Wait for the driver's `drive complete` signal before wrapping up. When you've received that signal and authored everything: if SPEC_WRITER_PRESENT=yes, SendMessage `spec-writer` with summary='snippets ready' BEFORE pinging team-lead — they're waiting on this signal before composing. Then SendMessage team-lead."
)
```

### 3.3. Spawn the spec-writer (spec mode only — skip in drive mode)

```
Agent(
  description="Compose spec",
  subagent_type="forge:spec-writer",
  team_name="<TEAM_NAME>",
  name="spec-writer",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
USER_TASK: <user's task verbatim>
PROJECT_HINT_SPEC_WRITER:
<spec-writer.md contents from <FORGE_ROOT>/hints/spec-writer.md, or 'none' if missing>

Your task is referenced as ID <SPEC_WRITER_TASK_ID> for the team's records. Wait for BOTH the driver's final-state message AND snippet-author's 'snippets ready' message before composing — the library may still be accruing when the driver finishes. Once both have arrived, write a self-contained .spec.ts to <FORGE_ROOT>/specs/ that composes snippets for invoked steps and inlines code for fresh-drive steps. Add assertions on captured values. When done, SendMessage `spec-verifier` with the spec path so they can verify it, then SendMessage team-lead."
)
```

### 3.4. Spawn the spec-verifier (spec mode only — skip in drive mode)

```
Agent(
  description="Verify spec from cold",
  subagent_type="forge:spec-verifier",
  team_name="<TEAM_NAME>",
  name="spec-verifier",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
PLUGIN_ROOT: <PLUGIN_ROOT>
USER_TASK: <user's task verbatim>
PROJECT_HINT_SPEC_VERIFIER:
<spec-verifier.md contents from <FORGE_ROOT>/hints/spec-verifier.md, or 'none' if missing>

Your task is referenced as ID <SPEC_VERIFIER_TASK_ID> for the team's records. Wait for spec-writer's 'spec ready' message. Run the spec via `forge-run-spec.mjs --spec <path>`. The verifier runs the spec the way Playwright itself would: fresh browser context, env from `process.env` as set by the user's shell plus whatever the project's playwright config loads. On pass, ping team-lead with verified-from-fresh status. On fail, ask driver (selectors) or spec-writer (assertions) for clarification, iterate up to 3 times, then succeed or escalate."
)
```

## Phase 4 — Wait for team to finish

After spawning, the teammates self-coordinate. You (the lead) wait. Messages from teammates auto-deliver as new conversation turns.

**What to watch for:**

- **Completion pings from the spawned teammates** — this is your primary signal that the team is done. Drive mode: wait for driver + snippet-author (2 pings). Spec mode: wait for driver + snippet-author + spec-writer + spec-verifier (4 pings). Each teammate SendMessages `team-lead` with a brief `task <id> complete` summary when their work is finished. Proceed to phase 5 only after you've received all expected pings. In spec mode, the natural order is driver/snippet-author → spec-writer → spec-verifier (spec-verifier waits for spec-writer's spec; spec-writer waits for driver's final-state). In drive mode, driver and snippet-author can finish in either order.
- **Messages addressed to you (`team-lead`)** — process them:
  - **STUCK from any teammate** (driver most commonly) — message is plain text with `STUCK` as the first line, then sections `QUESTION:`, `CONTEXT:`, and optionally `OPTIONS:` (each option as `- <label> | value: <value>`). Surface to the user via `AskUserQuestion`:
    - Build the question from the teammate's `QUESTION:` section.
    - If `OPTIONS:` is present, parse each `- <label> | value: <value>` line and map to an AskUserQuestion option (use the label as the AskUserQuestion option label, remember the value for the relay step). AskUserQuestion always also allows "Other" for free-form answers.
    - If no `OPTIONS:` section, ask the question open-ended — the user types their answer via "Other".
    - When the user responds, SendMessage the originating teammate with summary `stuck_response` and a plain-text body like `stuck_response — answer: <chosen-value-or-free-text>`. They'll wake on receive, parse out the answer, and continue. (SendMessage's `message` field accepts only strings, so send a plain-text body.)
    - The team is effectively paused while you wait for the user — don't try to do anything else. Once you relay the response, they resume on their own.
  - **`cannot-drive` from driver** — terminal failure. Surface to user as part of the final report; proceed to phase 5 cleanup (team's done).
  - **Status updates / questions from teammates** — answer concisely or relay relevant context.
  - **Anything you can't handle** — ask the user.
- **Idle notifications** — informational only. They fire after every turn including ones where the teammate is still working. Treat the explicit `task <id> complete` SendMessage as the authoritative signal — not idle notifications. The idle-notification stall watchdog below handles the case where a teammate finishes work but forgets to ping.

> **Note on `TaskList()`:** calling `TaskList` from the lead session does NOT surface team tasks reliably — completed tasks often report as `No tasks found`. Treat lead-pings as authoritative; don't gate phase 5 on TaskList status.

### 4.1. Idle-notification stall watchdog

A teammate that has finished its work but forgotten to ping `team-lead` will appear as a stream of idle notifications with no completion summary. Don't wait indefinitely — apply this heuristic:

For each teammate you're still expecting a completion ping from, keep a mental counter of consecutive idle notifications received from them with no progress. A notification *with* a peer-DM summary (e.g. `[to driver] confirm cart selector`) counts as progress and resets the counter; a notification with no summary, or only the bare `idleReason: available`, increments it.

When the counter reaches 3 for a given teammate, nudge them once:

```
SendMessage(
  to="<teammate-name>",
  summary="status check",
  message="Other teammates have reported work complete. What's your status — done? If your work is finished, please SendMessage team-lead with a completion summary so we can proceed to shutdown."
)
```

If they respond with a completion summary, treat it as the missing ping and proceed.

If 2 more idle notifications arrive after the nudge with no response, the teammate is genuinely stuck or has exited without a clean shutdown. Inspect whatever artifacts exist on disk (`ls <FORGE_ROOT>/snippets/` for snippet-author, `ls <FORGE_ROOT>/specs/` for spec-writer), surface the state to the user, and proceed with force-cleanup: skip the shutdown_request for the stalled teammate, call `TeamDelete()` (which may fail if the teammate process is still attached — in that case `rm -rf ~/.claude/teams/<TEAM_NAME> ~/.claude/tasks/<TEAM_NAME>` removes the directories directly), and continue to phase 5.3 to close the chromium session.

**Bounded waiting**: independently of the per-teammate watchdog, if 10+ minutes pass overall without all expected completion pings AND no STUCK / cannot-drive escalations, surface to user and prepare for force-cleanup.

## Phase 4.5 — Review hint proposals (on-demand)

Each teammate's completion ping ends with `proposals: <N>`. The `N` tells you whether to wait for a follow-up proposals message:

- `proposals: 0` — nothing to wait for; that teammate has no proposals.
- `proposals: <N>` where `N > 0` — wait for a separate `PROPOSALS` SendMessage before proceeding.

**If every teammate reported `proposals: 0`, skip this phase entirely** and proceed to Phase 5. Do not load the proposal-review reference; do not surface a "no proposals" message. Silence is the right outcome.

If any teammate reported `proposals: N > 0`:

1. Wait for that teammate's `PROPOSALS` SendMessage. Capture each body verbatim — you'll need them.
2. Load the proposal-review reference:

   ```bash
   cat <PLUGIN_ROOT>/skills/forge/references/proposal-review.md
   ```

3. Follow its instructions for aggregation, user review, and application.
4. When it hands back its "Hint files updated" summary, hold it for Phase 5.4's final report.

Loading the reference on-demand keeps the lead's prompt lean on happy-path runs where no proposals fire.

## Phase 5 — Shut down and clean up

Once all spawned teammates' tasks are `completed` (drive mode: driver + snippet-author; spec mode: driver + snippet-author + spec-writer + spec-verifier — you've received the matching completion pings):

### 5.1. Request shutdown

For each teammate you actually spawned (drive mode: driver + snippet-author; spec mode: all four):

```
SendMessage(
  to="<teammate-name>",
  summary="team work complete; shutdown",
  message={"type": "shutdown_request", "reason": "team work done"}
)
```

Wait for each to respond with `{"type": "shutdown_response", "approve": true, ...}`. The response includes a `paneId` field (e.g. `"%105"`) when the backend is tmux — capture these for the pane-cleanup step below. If a teammate rejects with `approve: false`, surface the rejection reason to the user — they may want to keep iterating before tearing down.

### 5.2. TeamDelete

After all teammates have approved shutdown:

```
TeamDelete()
```

This removes the team config and task list directories.

### 5.2a. Kill the leftover tmux panes

The Claude sessions exit cleanly on shutdown_approved, but tmux keeps each pane open with the shell underneath and the agent-set title still applied. To a user looking at their tmux window, it appears the agents "survived" shutdown. Clean them up using the `paneId` values captured from each `shutdown_response`:

```bash
tmux kill-pane -t <paneId>
```

Run this once per spawned teammate. Best-effort: if a pane is already gone (user closed it manually, tmux server restarted, etc.) the command exits non-zero and that's fine — `tmux kill-pane` failures should not block the rest of cleanup. Skip this step if the backend wasn't tmux (no `paneId` in the shutdown responses).

### 5.2b. Apply teardown instructions (optional)

Look for a `## Teardown after each run` (or similarly-named) section in `forge.md`. If present, execute its instructions as you would for setup: SQL queries, endpoint calls, whatever the user asked for. Examples: delete the test event/user that setup created, call a logout endpoint, reset server-side state.

If the hint has no teardown section, skip.

### 5.3. Close the chromium session

```bash
playwright-cli -s=<SESSION_NAME> close
```

Best-effort. If `playwright-cli close` errors or the chromium process survives, fall back to identifying and killing the process tree. The driver may have already done this if it cleaned up after itself, in which case the close call is a no-op.

### 5.4. Report to the user

Compose a tight summary. Drive mode is shorter — no spec/spec-verifier lines.

**Drive mode:**

> <driver's final-result one-liner>
>
> Snippet-author wrote N snippet(s):
>   - <name1> — <description>
> (or: "Snippet-author wrote 0 snippets — drive's work was covered by existing library.")
>
> Hint files updated: <one line per file with summary, e.g. "forge/hints/driver.md (+2 sections)">.
> (Omit this header entirely if no proposals were surfaced or all were rejected.)
>
> Browser session closed. Team cleaned up.

**Spec mode:**

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
> Slot released. Team cleaned up.

If anything didn't go to plan (a teammate returned `cannot-drive`, the spec-verifier escalated, snippet invocation failed mid-drive, etc.), surface that prominently — the user wants the truth, not a sanitized success report.

## Hard rules

- **You are an orchestrator, not an actor.** All browser driving belongs to `driver`. Snippet authoring belongs to `snippet-author`. Spec writing belongs to `spec-writer`. Spec verification belongs to `spec-verifier`. You set up the team, create tasks, spawn teammates, manage the lifecycle, AND **handle the user channel**: STUCK messages from teammates → AskUserQuestion → SendMessage the answer back. You do NOT invoke `playwright-cli` yourself, write snippet or spec files, run specs, or message-relay between teammates EXCEPT for STUCK-response (that's deliberately you relaying user input).
- **Teammates message each other directly.** Don't parse driver messages and forward to snippet-author — they're already addressed to snippet-author directly. You only handle messages explicitly addressed to `team-lead`.
- **Always close the chromium session.** Even if the drive returned `cannot-drive` or a teammate rejected shutdown, eventually call `playwright-cli -s=<SESSION_NAME> close`. Leaving chromium processes running wastes system resources and (in single-session-per-user apps) blocks the next legitimate login.
- **Always TeamDelete.** Don't leave team config files lying around in `~/.claude/teams/`.
- **One team at a time per session.** If a previous `/forge` invocation didn't clean up, `TeamDelete()` first before `TeamCreate`. (Claude Code allows only one active team per lead session.)
- **`forge.md` is the source of truth for test-account / credential resolution.** When the user names an account ("log in as admin"), the driver reads `forge.md` to find the env keys, the SQL recipe, or whatever scheme the project documents. Don't invent accounts; don't hardcode credentials.

## Failure modes to recover from

- **`TeamCreate` fails because a team already exists.** Call `TeamDelete()` first, then retry. (Note: `TeamDelete` fails if active teammates exist — you may need to shut them down first via SendMessage.)
- **Driver returns `cannot-drive` before doing meaningful work.** Snippet-author has nothing to author. Mark snippet-author's task complete with note "drive failed; no work to author"; proceed to shutdown and cleanup.
- **A teammate goes idle and never responds to your SendMessage.** It may have errored mid-turn. Try a follow-up nudge. If still no response, surface to user with the team's current state.
- **Credentials missing.** If the driver reports STUCK because a referenced env key isn't in process.env (e.g. `$ADMIN_USERNAME` expanded empty because ADMIN_USERNAME isn't set in the user's shell env), surface the missing key to the user with a clear request to set it before retrying.
