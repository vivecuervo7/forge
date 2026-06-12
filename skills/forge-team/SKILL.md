---
name: forge-team
description: "Drive browser tasks via the forge agent team — three teammates communicating in mesh (driver, author, spec-writer). Driver runs in a per-slot chromium with per-slot env injection, scans the snippet library and invokes existing snippets where they match (driving fresh only for novel work). Author writes snippets for novel work and skips invocations. Spec-writer composes a self-contained .spec.ts from the driver's final-state summary. Walks up from CWD to find the project's forge/ directory, loads hints, claims a pool slot, creates an agent team, manages the team lifecycle. Verifier teammate lands in Stage 4."
model: sonnet
effort: medium
argument-hint: "<description of the browser task to perform>"
allowed-tools: Read, Skill, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(direnv:*), Bash(playwright-cli:*), Bash(mkdir:*), Bash(jq:*), Bash(cat:*), Bash(echo:*), Bash(ls:*), Agent, SendMessage, TeamCreate, TeamDelete, TaskCreate, TaskList, TaskGet, TaskUpdate
---

# /forge-team

You are the **team lead** for a forge agent team. You manage the team's lifecycle (session-pool slot, team creation, task coordination, shutdown, cleanup) while teammates do the actual work via mesh communication. **You do not relay content between teammates — they SendMessage each other directly.** Your job is setup, lifecycle, and the user channel.

## Prerequisite

Agent teams are gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. If the `TeamCreate` tool isn't available in this session, surface this to the user with the remedy:

> /forge-team requires experimental agent teams. Enable by adding `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` to `~/.claude/settings.json` (or set the env var in your shell) and restart Claude Code.

Then stop.

## Phase 1 — Discovery and setup

### 1.1. Find the project's forge root

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-find-root.sh
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge-init`.

Capture as `FORGE_ROOT`.

### 1.2. Load the hints

```bash
cat <FORGE_ROOT>/hints/forge.md
cat <FORGE_ROOT>/hints/driver.md
cat <FORGE_ROOT>/hints/author.md
cat <FORGE_ROOT>/hints/spec-writer.md 2>/dev/null || echo "(no spec-writer.md — using defaults)"
```

Capture all four contents — you'll inline them in the spawn prompts so teammates don't need to read the files themselves.

If `forge.md` is missing, fail with: "missing forge/hints/forge.md — required to know how to set up env injection and the pool." Other hints are optional (teammates use defaults).

### 1.3. Determine pool location

Default `<FORGE_ROOT>/.pool/`. If `forge.md` declares an override under "Pool location", honor it. Capture as `POOL_DIR`.

### 1.4. Initialize the pool

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-init.sh <POOL_DIR>
```

Idempotent.

### 1.5. Claim a slot

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-claim.sh <POOL_DIR>
```

Three outcomes:

- **Slot path printed (exit 0)** — capture as `SLOT_DIR`; continue to phase 2.
- **`EXHAUSTED` (exit 1)** — execute the **Provisioning recipe** from `forge.md` (the hint enumerates exact steps: pick identifier, mkdir, write `.envrc`, write `state.json`, `direnv allow`, etc.). After provisioning, re-attempt the claim. If recipe genuinely can't satisfy a new slot, surface to user and stop.
- **Other error (exit ≥2)** — surface and stop.

### 1.6. Compute or retrieve the playwright-cli session name

```bash
SESSION_NAME=$(jq -r '.playwrightSessionName // empty' <SLOT_DIR>/state.json)
if [ -z "$SESSION_NAME" ]; then
  SESSION_NAME="ft-$(printf '%s' "<SLOT_DIR>" | md5 -q | cut -c1-8)"
  TMP=$(mktemp)
  jq --arg n "$SESSION_NAME" '.playwrightSessionName = $n' <SLOT_DIR>/state.json > "$TMP" && mv "$TMP" <SLOT_DIR>/state.json
fi
```

(On Linux, replace `md5 -q` with `md5sum | cut -d' ' -f1`.)

## Phase 2 — Create the team

### 2.1. Generate a team name

Use `forge-<run-id>` where `<run-id>` is a short identifier — derive from `SESSION_NAME` (already short and slot-bound) plus the current timestamp's last 4 digits to avoid collisions across reclaims:

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

The team currently has three tasks. Use `TaskCreate`:

```
TaskCreate(
  subject="drive: <USER_TASK>",
  description="Drive the user's browser task end-to-end in the slot at <SLOT_DIR>. Scan <FORGE_ROOT>/snippets/ first and invoke matching snippets via forge-pool-invoke-snippet.mjs instead of driving fresh. Narrate each step to `author` as 'invoked X' or 'drove fresh: X'. At end of drive, send `spec-writer` a final-state summary. Mark complete when the drive is finished; stay idle (advisor phase) until shutdown."
)
# Note the task ID returned — call it DRIVE_TASK_ID.

TaskCreate(
  subject="author snippets from drive",
  description="Receive driver narration via SendMessage. Skip 'invoked' chunks (already in library). For 'drove fresh' chunks, decide which are snippet-worthy and write them to <FORGE_ROOT>/snippets/. Ask driver clarifying questions as needed. Mark complete when drive is done."
)
# Note as AUTHOR_TASK_ID.

TaskCreate(
  subject="spec-writer: produce self-contained spec from drive",
  description="Wait for driver's final-state summary at end of drive. Compose a self-contained .spec.ts in <FORGE_ROOT>/specs/ that reproduces the user task: import + compose snippets for invoked steps, inline code for fresh-drive steps, assert on captured values. Spec must be runnable from cold start. Mark complete when written."
)
# Note as SPEC_WRITER_TASK_ID.
```

Don't set ownership in TaskCreate — teammates claim their own tasks.

## Phase 3 — Spawn the teammates

### 3.1. Spawn the driver

```
Agent(
  subagent_type="forge:driver-team",
  team_name="<TEAM_NAME>",
  name="driver",
  prompt="TEAM_NAME: <TEAM_NAME>
FORGE_SLOT: <SLOT_DIR>
SESSION_NAME: <SESSION_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
PROJECT_HINT_FORGE:
<forge.md contents>

PROJECT_HINT_DRIVER:
<driver.md contents, or 'none' if missing>

USER_TASK: <user's task verbatim>

Your task ID is <DRIVE_TASK_ID>. Claim it via TaskUpdate(owner='driver', status='in_progress'), then begin driving. SendMessage `author` with structured summaries after meaningful steps. When the drive is done, TaskUpdate status='completed' and go idle — author may have follow-up questions."
)
```

### 3.2. Spawn the author

```
Agent(
  subagent_type="forge:author-team",
  team_name="<TEAM_NAME>",
  name="author",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
USER_TASK: <user's task verbatim>
PROJECT_HINT_AUTHOR:
<author.md contents, or 'none' if missing>

Your task ID is <AUTHOR_TASK_ID>. Claim it via TaskUpdate(owner='author', status='in_progress'), then wait for driver messages. Process messages as they arrive; write snippets to <FORGE_ROOT>/snippets/; SendMessage `driver` with clarifying questions if needed. Mark task complete when drive is done and snippets are written."
)
```

### 3.3. Spawn the spec-writer

```
Agent(
  subagent_type="forge:spec-writer-team",
  team_name="<TEAM_NAME>",
  name="spec-writer",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
USER_TASK: <user's task verbatim>
PROJECT_HINT_SPEC_WRITER:
<spec-writer.md contents from <FORGE_ROOT>/hints/spec-writer.md, or 'none' if missing>

Your task ID is <SPEC_WRITER_TASK_ID>. Claim it via TaskUpdate(owner='spec-writer', status='in_progress'). Wait for driver's final-state message at end of drive. Write a self-contained .spec.ts to <FORGE_ROOT>/specs/ that composes snippets for invoked steps and inlines code for fresh-drive steps. Add assertions on captured values. Mark task complete when written."
)
```

To load `spec-writer.md`, attempt `cat <FORGE_ROOT>/hints/spec-writer.md 2>/dev/null` during phase 1.2; if it doesn't exist, pass `none` as the hint content (the agent will use universal defaults).

## Phase 4 — Wait for team to finish

After spawning, the teammates self-coordinate. You (the lead) wait. Messages from teammates auto-deliver as new conversation turns.

**What to watch for:**

- **Completion pings from all three teammates** — this is your primary signal that the team is done. Driver, author, and spec-writer each SendMessage `team-lead` with a brief `task <id> complete` summary after marking their task `completed` via TaskUpdate. When you've received ALL THREE pings, proceed to phase 5. Note: spec-writer's ping arrives last (they wait for driver's final-state message before composing the spec).
- **Messages addressed to you (`team-lead`)** — process them:
  - `STUCK: ...` from driver → surface to user, get user response, SendMessage back to driver (Stage 5 work; if it happens in Stage 3a, just surface the question and tell the user the team is paused).
  - Status updates / questions from teammates → answer concisely or relay relevant context.
  - Anything you can't handle → ask the user.
- **Idle notifications** — informational only. They fire after every turn including ones where the teammate is still working. Do NOT treat an idle notification as a "done" signal — wait for the explicit `task <id> complete` SendMessage instead. An idle teammate with an incomplete task hasn't finished; they're just between turns.

> **Note on `TaskList()`:** calling `TaskList` from the lead session does NOT surface team tasks reliably — completed tasks often report as `No tasks found`. Treat lead-pings as authoritative; don't gate phase 5 on TaskList status.

**Bounded waiting**: if 10+ minutes pass without both completion pings AND no other messages from teammates, something's stuck. SendMessage each teammate asking for a status update. If they don't respond, the team may need manual recovery — surface to user.

## Phase 5 — Shut down and clean up

Once all three tasks are `completed` (you've received completion pings from driver, author, AND spec-writer):

### 5.1. Request shutdown

For each teammate (driver, author, spec-writer):

```
SendMessage(
  to="<teammate-name>",
  summary="team work complete; shutdown",
  message={"type": "shutdown_request", "reason": "team work done"}
)
```

Wait for each to respond with `{"type": "shutdown_response", "approve": true, ...}`. If a teammate rejects with `approve: false`, surface the rejection reason to the user — they may want to keep iterating before tearing down.

### 5.2. TeamDelete

After all teammates have approved shutdown:

```
TeamDelete()
```

This removes the team config and task list directories.

### 5.3. Release the pool slot

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-release.sh <POOL_DIR> <SLOT_DIR>
```

### 5.4. Report to the user

Compose a tight summary:

> Drove via `slot-<persona>`.
>
> <driver's final-result one-liner>
>
> Author wrote N snippet(s):
>   - <name1> — <description>
>   - <name2> — <description>
> (or: "Author wrote 0 snippets — drive's work was covered by existing library.")
>
> Spec-writer wrote `<name>.spec.ts` composing <list of snippets> and asserting <one-liner>.
> (or: "Spec-writer updated `<name>.spec.ts` in place" / "No new spec — existing one covers this.")
>
> Slot released. Team cleaned up.

If anything didn't go to plan (a teammate returned `cannot-drive`, the verifier escalated, snippet invocation failed mid-drive, etc.), surface that prominently — the user wants the truth, not a sanitized success report.

## Hard rules

- **You are an orchestrator, not an actor.** All browser driving belongs to `driver`. Snippet authoring belongs to `author`. Spec writing belongs to `spec-writer`. You set up the team, create tasks, spawn teammates, manage the lifecycle, handle the user channel. You do NOT invoke `playwright-cli` yourself, write snippet or spec files, or message-relay between teammates.
- **Teammates message each other directly.** Do NOT parse driver messages and forward to author — they're already addressed to author directly. You only handle messages explicitly addressed to `team-lead`.
- **Always release the slot.** Even if the drive returned `cannot-drive` or a teammate rejected shutdown, eventually call `forge-pool-release.sh`. Leaving a slot perpetually checked out wastes capacity.
- **Always TeamDelete.** Don't leave team config files lying around in `~/.claude/teams/`.
- **One team at a time per session.** If a previous `/forge-team` invocation didn't clean up, `TeamDelete()` first before `TeamCreate`. (Claude Code allows only one active team per lead session.)
- **Provisioning recipe is the source of truth for slot creation.** Don't invent fields. Execute literally from the hint.

## What this skill DOES do (current capabilities)

- **Pool-aware slot management** — claims a per-persona/per-instance chromium slot, applies the project's provisioning recipe on exhaustion, releases with cookie + localStorage + sessionStorage wipe.
- **Mesh agent team** — spawns `driver`, `author`, and `spec-writer` as named teammates that SendMessage each other directly (no lead-mediated relay). Lead handles lifecycle only.
- **Snippet library reuse** — driver scans `<PROJECT_FORGE_ROOT>/snippets/` at planning time and invokes existing snippets via `forge-pool-invoke-snippet.mjs` instead of re-driving. Author skips invoked steps (no duplicates) and may patch existing snippets in place when driver's narration reveals a latent bug.
- **Snippet authoring discipline** — author only writes snippets for fresh-drive steps (no library coverage). Library grows from successful novel work; never duplicates.
- **Spec generation that composes the library** — spec-writer receives driver's final-state summary and writes a self-contained `.spec.ts` to `<PROJECT_FORGE_ROOT>/specs/`. Invoked steps become `snippet.run()` calls; fresh-drive steps become inline code; captured values become `expect()` assertions.

## What this skill does NOT do (yet)

- **No verifier teammate.** Stage 4 adds `forge:verifier-team` and the in-slot advisor-phase verification loop — verifier runs the spec against the still-warm slot, asks driver/spec-writer questions on failure, iterates until pass.
- **No user escalation channel for stuck-driver scenarios.** Stage 5. If the driver SendMessages you `STUCK: ...`, surface it manually and pause the team.
- **No parallel-runs handling beyond what the pool already provides.** Stage 6 stress-tests concurrent invocations.

## Failure modes to recover from

- **`TeamCreate` fails because a team already exists.** Call `TeamDelete()` first, then retry. (Note: `TeamDelete` fails if active teammates exist — you may need to shut them down first via SendMessage.)
- **`forge-pool-claim.sh` keeps returning EXHAUSTED even after provisioning.** The provisioning recipe may have a bug — look at the slot dir to confirm everything's in place. Surface to user if you can't diagnose.
- **Driver returns `cannot-drive` before doing meaningful work.** Author has nothing to author. Mark author's task complete with note "drive failed; no work to author"; proceed to shutdown and cleanup. Don't leave author hanging.
- **A teammate goes idle and never responds to your SendMessage.** It may have errored mid-turn. Try a follow-up nudge. If still no response, surface to user with the team's current state.
