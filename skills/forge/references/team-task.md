# /forge — team-task reference (base, drive mode)

This reference is loaded by `/forge`'s router for the **task** and **spec** routes. The router has already:

- Decided `MODE` (one of `drive` | `spec`)
- Stripped any leading `spec` keyword from the task description
- Resolved `PLUGIN_ROOT` to the plugin's install path (see SKILL.md phase 1.0)

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below is a placeholder — substitute the literal path captured by the router. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in the bash context that runs from this reference.

**If `MODE=spec`, also load `references/team-task-spec.md`** — it adds Phase 2.3 spec tasks, Phase 3.3/3.4 spec spawns, and the spec-mode final report shape. Otherwise skip; this base file is sufficient for drive mode.

Below is the full lifecycle for running an agent team against an ephemeral chromium session. You are the **team lead**: you manage lifecycle (session creation, team creation, task coordination, shutdown, cleanup) while teammates do the actual work via mesh communication. **You do not relay content between teammates — they SendMessage each other directly.** Your job is setup, lifecycle, and the user channel.

Drive-mode lifecycle at a glance:

| Step | drive mode |
|---|---|
| Tasks created in phase 2.3 | 2 (driver, snippet-author) |
| Teammates spawned in phase 3 | driver, snippet-author |
| Completion pings to wait for in phase 4 | 2 |
| Final report | "drove the task" |

Spec mode adds two more teammates, two more pings, and a verified-spec line — see the spec addendum.

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

### 1.2. Load the forge.md hint (lead-only)

```bash
cat <FORGE_ROOT>/hints/forge.md 2>/dev/null || echo ""
```

You need `forge.md` for persona/account resolution and the optional setup/teardown sections in Phases 1.4 and 5.2b. The other hint files (`driver.md`, `snippet-author.md`, `spec-writer.md`, `spec-verifier.md`) are each read by their respective agent — the lead doesn't carry them. Empty string is fine; teammates fall back to defaults.

All hints are optional. A bare `/forge init` scaffold drives correctly; hints encode project-specific knowledge agents can't derive from the app itself.

### 1.3. Generate a session name

Forge runs are stateless — each invocation gets its own chromium with a fresh, ephemeral profile. Generate a unique playwright-cli session name:

```bash
echo "ft-$(node -e 'console.log(require("crypto").randomBytes(4).toString("hex"))')"
```

Capture as `SESSION_NAME`. Used by the driver to launch/reference the browser and by phase 5 to close it.

### 1.3a. Check cleanup staleness (silent — surface at end)

Read `<FORGE_ROOT>/.last-cleanup` if it exists:

```bash
cat <FORGE_ROOT>/.last-cleanup 2>/dev/null || echo ""
```

JSON of the form `{ "hints": "<ISO timestamp>", "snippets": "<ISO timestamp>" }`. Compute days-since for each key.

Capture `CLEANUP_NUDGE` as one of:

- **empty** if the file doesn't exist and both `forge/hints/` and `forge/snippets/` are sparse (under ~3 files combined).
- **`hints` / `snippets` / `both`** if the file is missing on a non-sparse project, or the corresponding timestamp is older than 7 days.

Hold for Phase 5.4. **Do not surface now** — maintenance nudges at task start fight the user's actual intent. Surface at end-of-run as a one-line tail.

### 1.4. Apply setup instructions (optional)

If `forge.md` has a `## Setup before each run` section, follow it literally. Examples: SQL seeding, account-reset endpoint, mint a fresh test user, "don't reset anything."

If absent, skip — each session's chromium profile is fresh.

If setup captures values (e.g. minted credentials), hold them in your context — pass to the driver via spawn prompt or append to the env contract in `forge.md`.

If setup fails, surface to the user and stop.

## Phase 2 — Create the team

### 2.1. Generate a team name

Use `forge-<run-id>`:

```bash
RUN_ID="${SESSION_NAME#ft-}-$(date +%s | tail -c 5)"
TEAM_NAME="forge-${RUN_ID}"
```

### 2.2. Create the team

```
TeamCreate(team_name="<TEAM_NAME>", description="Forge agent team for: <USER_TASK>")
```

Creates the team config at `~/.claude/teams/<TEAM_NAME>/config.json` and task list directory at `~/.claude/tasks/<TEAM_NAME>/`.

### 2.3. Create the tasks

Create the driver + snippet-author tasks.

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

**If MODE == spec**, also create the spec-writer + spec-verifier tasks (see `team-task-spec.md` Phase 2.3).

Don't set ownership in TaskCreate — teammates claim their own tasks.

## Phase 3 — Spawn the teammates

Spawn driver + snippet-author. **If `MODE == spec`**, follow `team-task-spec.md` Phase 3.0 to load agent-level spec addenda, then 3.3/3.4 to spawn the spec-writer + spec-verifier after the two below.

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
USER_TASK: <user's task verbatim>

<if MODE == spec, include the block:>
SPEC MODE ADDENDUM:
<DRIVER_SPEC_ADDENDUM verbatim>
<end conditional block — omit entirely in drive mode>

Your task is referenced as ID <DRIVE_TASK_ID> for the team's records. Read your hints (forge.md + driver.md from <FORGE_ROOT>/hints/) as step 1, then begin driving."
)
```

`description` is required by the Agent tool — keep it short.

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

<if MODE == spec, include the block:>
SPEC MODE ADDENDUM:
<AUTHOR_SPEC_ADDENDUM verbatim>
<end conditional block — omit entirely in drive mode>

Your task is referenced as ID <SNIPPET_AUTHOR_TASK_ID> for the team's records. Read your hints (forge.md + snippet-author.md from <FORGE_ROOT>/hints/) as step 1, then wait for driver messages."
)
```

In spec mode, follow `team-task-spec.md` Phase 3.3 (spawn spec-writer) and 3.4 (spawn spec-verifier) before proceeding to Phase 4.

## Phase 4 — Wait for team to finish

After spawning, teammates self-coordinate. You wait. Messages auto-deliver as new conversation turns.

**What to watch for:**

- **Completion pings from spawned teammates** — primary signal that the team is done. Drive mode: 2 pings (driver + snippet-author). In spec mode the count rises — see `team-task-spec.md` Phase 4. Each teammate SendMessages `team-lead` with `task <id> complete` when finished. Proceed to phase 5 only after all expected pings.
- **Messages addressed to you (`team-lead`)** — process them:
  - **STUCK from any teammate** — plain text with `STUCK` as first line, then `QUESTION:`, `CONTEXT:`, optionally `OPTIONS:` (`- <label> | value: <value>`). Surface via `AskUserQuestion`:
    - Build the question from `QUESTION:`.
    - Parse `OPTIONS:` lines to AskUserQuestion options (label as option label, remember value for relay). AskUserQuestion always allows "Other".
    - If no `OPTIONS:`, ask open-ended.
    - On user response, SendMessage the originating teammate with summary `stuck_response` and body `stuck_response — answer: <chosen-value-or-free-text>`. (SendMessage's `message` accepts only strings.)
    - Team is paused while waiting for the user; resume on relay.
  - **`cannot-drive` from driver** — terminal failure. Surface in final report; proceed to phase 5 cleanup.
  - **Status updates / questions** — answer concisely or relay context.
  - **Anything you can't handle** — ask the user.
- **Idle notifications** — informational only; fire after every turn including ones still working. Treat `task <id> complete` as authoritative — not idle notifications. The watchdog below handles teammates that finish but forget to ping.

> **Note on `TaskList()`:** calling `TaskList` from the lead session does NOT surface team tasks reliably — completed tasks often report as `No tasks found`. Treat lead-pings as authoritative; don't gate phase 5 on TaskList.

### 4.1. Idle-notification stall watchdog

A teammate that finished work but forgot to ping will appear as a stream of idle notifications with no completion summary. Don't wait indefinitely.

For each teammate you're still expecting a completion ping from, keep a counter of consecutive idle notifications with no progress. A notification *with* a peer-DM summary (e.g. `[to driver] confirm cart selector`) counts as progress and resets the counter; a bare `idleReason: available` increments it.

When the counter reaches 3, nudge once:

```
SendMessage(
  to="<teammate-name>",
  summary="status check",
  message="Other teammates have reported work complete. What's your status — done? If finished, please SendMessage team-lead with a completion summary so we can proceed to shutdown."
)
```

If they respond with a completion summary, treat it as the missing ping.

If 2 more idle notifications arrive after the nudge with no response, the teammate is stuck or has exited uncleanly. Inspect on-disk artifacts (`ls <FORGE_ROOT>/snippets/`, `ls <FORGE_ROOT>/specs/`), surface state to the user, force-cleanup: skip shutdown_request for the stalled teammate, call `TeamDelete()` (which may fail if the teammate process is still attached — fall back to `rm -rf ~/.claude/teams/<TEAM_NAME> ~/.claude/tasks/<TEAM_NAME>`), continue to phase 5.3.

**Bounded waiting**: if 10+ minutes pass overall without all expected pings AND no STUCK / cannot-drive escalations, surface to user and prepare for force-cleanup.

## Phase 4.5 — Review hint proposals (on-demand)

Each teammate's completion ping ends with `proposals: <N>`:

- `proposals: 0` — nothing to wait for.
- `proposals: <N>` where `N > 0` — wait for a separate `PROPOSALS` SendMessage before proceeding.

**If every teammate reported `proposals: 0`, skip this phase entirely** and proceed to Phase 5. Don't load the proposal-review reference; don't surface "no proposals". Silence is the right outcome.

If any teammate reported `proposals: N > 0`:

1. Wait for that teammate's `PROPOSALS` SendMessage. Capture each body verbatim.
2. Load the proposal-review reference:

   ```bash
   cat <PLUGIN_ROOT>/skills/forge/references/proposal-review.md
   ```

3. Follow its instructions for aggregation, user review, and application.
4. Hold its "Hint files updated" summary for Phase 5.4's final report.

On-demand loading keeps the lead's prompt lean on happy-path runs.

## Phase 5 — Shut down and clean up

Once all spawned teammates' completion pings have arrived (drive mode: 2; spec mode adds two more — see `team-task-spec.md`):

### 5.1. Request shutdown

For each spawned teammate:

```
SendMessage(
  to="<teammate-name>",
  summary="team work complete; shutdown",
  message={"type": "shutdown_request", "reason": "team work done"}
)
```

Wait for each to respond with `{"type": "shutdown_response", "approve": true, ...}`. The response includes a `paneId` (e.g. `"%105"`) when the backend is tmux — capture for pane-cleanup. If a teammate rejects with `approve: false`, surface the reason to the user.

### 5.2. TeamDelete

After all teammates have approved shutdown:

```
TeamDelete()
```

Removes the team config and task list directories.

### 5.2a. Kill the leftover tmux panes

Claude sessions exit cleanly on shutdown_approved, but tmux keeps panes open with the shell underneath and the agent-set title applied. To a user looking at their tmux window, it appears agents "survived" shutdown. Clean up using `paneId` values from each `shutdown_response`:

```bash
tmux kill-pane -t <paneId>
```

Once per spawned teammate. Best-effort — `tmux kill-pane` failures (pane already gone) should not block cleanup. Skip if backend wasn't tmux (no `paneId` in responses).

### 5.2b. Apply teardown instructions (optional)

Look for a `## Teardown after each run` section in `forge.md`. If present, execute its instructions (SQL queries, endpoint calls, etc.).

If absent, skip.

### 5.3. Close the chromium session

```bash
playwright-cli -s=<SESSION_NAME> close
```

Best-effort. If `playwright-cli close` errors or chromium survives, fall back to killing the process tree. Driver may have already done this — close call is a no-op then.

### 5.4. Report to the user

Compose a tight summary. Drive-mode shape:

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

In spec mode, use the extended shape in `team-task-spec.md` Phase 5.4 — it adds the spec-writer and spec-verifier lines.

If anything didn't go to plan (a teammate returned `cannot-drive`, snippet invocation failed mid-drive, etc.), surface prominently — the user wants the truth, not a sanitized success report.

### 5.4a. Append cleanup nudge (if captured in 1.3a)

If `CLEANUP_NUDGE` from Phase 1.3a is non-empty, append a one-line tail:

- `CLEANUP_NUDGE=hints` — *"Last hint cleanup was N days ago — consider `/forge clean hints` after this run."* (Use "never" if the staleness file didn't exist.)
- `CLEANUP_NUDGE=snippets` — *"Last snippet cleanup was N days ago — consider `/forge clean snippets` after this run."*
- `CLEANUP_NUDGE=both` — *"Hints and snippets haven't been cleaned in over a week — consider `/forge clean` after this run."* (Or, if staleness file missing entirely: *"No record of any forge cleanup — consider `/forge clean` to baseline.")

Non-blocking and once-per-run. Don't surface mid-task; don't gate shutdown on it; don't repeat if user already invoked clean this session.

## Hard rules

- **You are an orchestrator, not an actor.** All browser driving belongs to `driver`. Snippet authoring belongs to `snippet-author`. Spec writing belongs to `spec-writer`. Spec verification belongs to `spec-verifier`. You set up the team, create tasks, spawn teammates, manage the lifecycle, AND **handle the user channel**: STUCK messages from teammates → AskUserQuestion → SendMessage the answer back. You do NOT invoke `playwright-cli` yourself, write snippet or spec files, run specs, or message-relay between teammates EXCEPT for STUCK-response (that's deliberately you relaying user input).
- **Teammates message each other directly.** Don't parse driver messages and forward to snippet-author — they're already addressed to snippet-author directly. You only handle messages explicitly addressed to `team-lead`.
- **Always close the chromium session.** Even if the drive returned `cannot-drive` or a teammate rejected shutdown, eventually call `playwright-cli -s=<SESSION_NAME> close`. Leaving chromium processes running wastes system resources and (in single-session-per-user apps) blocks the next legitimate login.
- **Always TeamDelete.** Don't leave team config files lying around in `~/.claude/teams/`.
- **One team at a time per session.** If a previous `/forge` invocation didn't clean up, `TeamDelete()` first before `TeamCreate`. (Claude Code allows only one active team per lead session.)
- **`forge.md` is the source of truth for test-account / credential resolution.** When the user names an account ("log in as admin"), the driver reads `forge.md` to find the env keys, the SQL recipe, or whatever scheme the project documents. Don't invent accounts; don't hardcode credentials.

## Failure modes to recover from

- **`TeamCreate` fails because a team already exists.** Call `TeamDelete()` first, then retry. (`TeamDelete` fails if active teammates exist — shut them down first via SendMessage.)
- **Driver returns `cannot-drive` before doing meaningful work.** Snippet-author has nothing to author. Mark its task complete with note "drive failed; no work to author"; proceed to cleanup.
- **A teammate goes idle and never responds to your SendMessage.** May have errored mid-turn. Follow-up nudge. If still no response, surface to user with the team's current state.
- **Credentials missing.** Driver reports STUCK because an env key expanded empty (e.g. `$ADMIN_USERNAME` not set). Surface the missing key to the user.
