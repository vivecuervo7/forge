# /forge — team-task reference (drive + spec modes)

This reference is loaded by `/forge`'s router for **task** and **spec** routes. The router has already:

- Decided `MODE` (one of `drive` | `spec`)
- Stripped any leading `spec` keyword from the task description

Recording is **not** handled by this reference. Spec mode produces a verified spec; recording (for evidence) lives under the separate `/forge run` route. If the user's task includes a recording label phrase like "record as before" in spec mode, ignore the recording portion and surface a note in the final report pointing them at `/forge run` for that workflow.

Below is the full lifecycle for running an agent team against the project's slot pool. You are the **team lead**: you manage the team's lifecycle (session-pool slot, team creation, task coordination, shutdown, cleanup) while teammates do the actual work via mesh communication. **You do not relay content between teammates — they SendMessage each other directly.** Your job is setup, lifecycle, and the user channel.

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
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-find-root.sh
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge init`.

Capture as `FORGE_ROOT`.

### 1.2. Load the hints

```bash
cat <FORGE_ROOT>/hints/forge.md
cat <FORGE_ROOT>/hints/driver.md
cat <FORGE_ROOT>/hints/snippet-author.md
cat <FORGE_ROOT>/hints/spec-writer.md 2>/dev/null || echo "(no spec-writer.md — using defaults)"
cat <FORGE_ROOT>/hints/spec-verifier.md 2>/dev/null || echo "(no spec-verifier.md — using defaults)"
```

Capture all five contents — you'll inline them in the spawn prompts so teammates don't need to read the files themselves.

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

### 1.5b. Apply setup instructions

Before handing the slot to the team, reset its state per the project's policy. You are the only place hints get interpreted — the mechanical scripts know nothing about them.

1. **Look for a `## Setup before each run` (or similarly-named) section in `forge.md`.** The user writes it in their own words; treat it as instructions to you, not as a config file. They might describe SQL to run, an account-reset endpoint to call, a directory to wipe, or an explicit "don't reset anything."

2. **Decide whether the default scrub applies.** The default is: invoke

   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-reset.sh <SLOT_DIR>
   ```

   which deletes cookies + localStorage + sessionStorage from the slot's chromium profile (the universally-biting class — cart state, stale auth, etc.). Run it **unless** the hint clearly tells you not to (e.g. "don't reset any state between runs," "runs share state intentionally"). If there's no section at all, run the default.

3. **Execute any additional instructions the hint provides.** Use the tools you already have: `Bash` for SQL via `psql`, shell commands, file deletes; `curl` for endpoint calls; whatever the user asked for. Use any captured values (e.g. a freshly-generated test-user email) by re-writing them into the slot's `.env` so the spawned spec/teammates pick them up:

   ```bash
   # example only — pattern, not prescription
   echo "TEST_USER_EMAIL=$generated" >> <SLOT_DIR>/.env
   ```

4. If the hint's instructions fail (SQL error, endpoint timeout, etc.), surface to the user and stop — don't proceed with a half-initialized slot.

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

Always create the driver + snippet-author tasks. Add the spec-writer + spec-verifier tasks **only in spec mode**.

```
TaskCreate(
  subject="drive: <USER_TASK>",
  description="Drive the user's browser task end-to-end in the slot at <SLOT_DIR>. Scan <FORGE_ROOT>/snippets/ first and invoke matching snippets via forge-pool-invoke-snippet.mjs instead of driving fresh. Narrate each step to `snippet-author` as 'invoked X' or 'drove fresh: X'. MODE=<MODE>: in spec mode, at end of drive, send `spec-writer` a final-state summary. In drive mode, no spec-writer to message — just ping team-lead and go idle. Mark complete when the drive is finished; stay idle (advisor phase) until shutdown."
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
  subject="spec-verifier: run spec against slot, confirm it passes from cold start",
  description="Wait for spec-writer's 'spec ready' message. Run the spec via forge-pool-run-spec.mjs --spec <path> --slot <SLOT_DIR> (no --record — recording is a separate concern handled by /forge run). On pass: ping team-lead with verified-from-fresh status. On fail: SendMessage driver (selectors) or spec-writer (assertions/imports) for clarification, iterate up to 3 times, then either succeed or escalate. Mark complete when done."
)
# Note as SPEC_VERIFIER_TASK_ID.
```

Don't set ownership in TaskCreate — teammates claim their own tasks.

## Phase 3 — Spawn the teammates

Always spawn driver + snippet-author. In spec mode, also spawn spec-writer + spec-verifier.

### 3.1. Spawn the driver

```
Agent(
  subagent_type="forge:driver",
  team_name="<TEAM_NAME>",
  name="driver",
  prompt="TEAM_NAME: <TEAM_NAME>
MODE: <MODE>
SPEC_WRITER_PRESENT: <yes if MODE=spec, else no>
FORGE_SLOT: <SLOT_DIR>
SESSION_NAME: <SESSION_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
PROJECT_HINT_FORGE:
<forge.md contents>

PROJECT_HINT_DRIVER:
<driver.md contents, or 'none' if missing>

USER_TASK: <user's task verbatim>

Your task ID is <DRIVE_TASK_ID>. Claim it via TaskUpdate(owner='driver', status='in_progress'), then begin driving. SendMessage `snippet-author` with structured summaries after meaningful steps. When SPEC_WRITER_PRESENT=yes, send `spec-writer` a final-state summary at end of drive. When SPEC_WRITER_PRESENT=no, skip that — just TaskUpdate status='completed' and ping team-lead. Then go idle — snippet-author may have follow-up questions."
)
```

### 3.2. Spawn the snippet-author

```
Agent(
  subagent_type="forge:snippet-author",
  team_name="<TEAM_NAME>",
  name="snippet-author",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
USER_TASK: <user's task verbatim>
PROJECT_HINT_SNIPPET_AUTHOR:
<snippet-author.md contents, or 'none' if missing>

Your task ID is <SNIPPET_AUTHOR_TASK_ID>. Claim it via TaskUpdate(owner='snippet-author', status='in_progress'), then wait for driver messages. Process messages as they arrive; write snippets to <FORGE_ROOT>/snippets/; SendMessage `driver` with clarifying questions if needed. Mark task complete when drive is done and snippets are written."
)
```

### 3.3. Spawn the spec-writer (spec mode only — skip in drive mode)

```
Agent(
  subagent_type="forge:spec-writer",
  team_name="<TEAM_NAME>",
  name="spec-writer",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
USER_TASK: <user's task verbatim>
PROJECT_HINT_SPEC_WRITER:
<spec-writer.md contents from <FORGE_ROOT>/hints/spec-writer.md, or 'none' if missing>

Your task ID is <SPEC_WRITER_TASK_ID>. Claim it via TaskUpdate(owner='spec-writer', status='in_progress'). Wait for driver's final-state message at end of drive. Write a self-contained .spec.ts to <FORGE_ROOT>/specs/ that composes snippets for invoked steps and inlines code for fresh-drive steps. Add assertions on captured values. When done, SendMessage `spec-verifier` with the spec path so they can verify it. Mark task complete after."
)
```

### 3.4. Spawn the spec-verifier (spec mode only — skip in drive mode)

```
Agent(
  subagent_type="forge:spec-verifier",
  team_name="<TEAM_NAME>",
  name="spec-verifier",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
FORGE_SLOT: <SLOT_DIR>
PLUGIN_ROOT: ${CLAUDE_PLUGIN_ROOT}
USER_TASK: <user's task verbatim>
PROJECT_HINT_SPEC_VERIFIER:
<spec-verifier.md contents from <FORGE_ROOT>/hints/spec-verifier.md, or 'none' if missing>

Your task ID is <SPEC_VERIFIER_TASK_ID>. Claim it via TaskUpdate(owner='spec-verifier', status='in_progress'). Wait for spec-writer's 'spec ready' message. Run the spec via forge-pool-run-spec.mjs --spec <path> --slot <FORGE_SLOT> (no --record — recording is /forge run's job, not spec mode's). On pass, ping team-lead with verified-from-fresh status. On fail, ask driver (selectors) or spec-writer (assertions) for clarification, iterate up to 3 times, then succeed or escalate."
)
```

## Phase 4 — Wait for team to finish

After spawning, the teammates self-coordinate. You (the lead) wait. Messages from teammates auto-deliver as new conversation turns.

**What to watch for:**

- **Completion pings from the spawned teammates** — this is your primary signal that the team is done. Drive mode: wait for driver + snippet-author (2 pings). Spec mode: wait for driver + snippet-author + spec-writer + spec-verifier (4 pings). Each teammate SendMessages `team-lead` with a brief `task <id> complete` summary after marking their task `completed` via TaskUpdate. Proceed to phase 5 only after you've received all expected pings. In spec mode, the natural order is driver/snippet-author → spec-writer → spec-verifier (spec-verifier waits for spec-writer's spec; spec-writer waits for driver's final-state). In drive mode, driver and snippet-author can finish in either order.
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
- **Idle notifications** — informational only. They fire after every turn including ones where the teammate is still working. Treat the explicit `task <id> complete` SendMessage as the authoritative signal — not idle notifications.

> **Note on `TaskList()`:** calling `TaskList` from the lead session does NOT surface team tasks reliably — completed tasks often report as `No tasks found`. Treat lead-pings as authoritative; don't gate phase 5 on TaskList status.

**Bounded waiting**: if 10+ minutes pass without all completion pings AND no other messages from teammates, something's stuck. SendMessage each teammate asking for a status update. If they don't respond, the team may need manual recovery — surface to user.

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

Wait for each to respond with `{"type": "shutdown_response", "approve": true, ...}`. If a teammate rejects with `approve: false`, surface the rejection reason to the user — they may want to keep iterating before tearing down.

### 5.2. TeamDelete

After all teammates have approved shutdown:

```
TeamDelete()
```

This removes the team config and task list directories.

### 5.2b. Apply teardown instructions

Mirror of phase 1.5b for end-of-run cleanup. Look for a `## Teardown after each run` (or similarly-named) section in `forge.md`. If present, execute its instructions as you would for setup: SQL queries, endpoint calls, whatever the user asked for. There is no automatic teardown default — the start-of-next-run scrub handles client-side leakage. This phase is purely for things the project knows about that forge can't (server-side state, account cleanup, third-party integrations, etc.).

If the hint has no teardown section, skip this phase entirely.

### 5.3. Release the pool slot

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-release.sh <POOL_DIR> <SLOT_DIR>
```

### 5.4. Report to the user

Compose a tight summary. Drive mode is shorter — no spec/spec-verifier lines.

**Drive mode:**

> Drove via `slot-<persona>`.
>
> <driver's final-result one-liner>
>
> Snippet-author wrote N snippet(s):
>   - <name1> — <description>
> (or: "Snippet-author wrote 0 snippets — drive's work was covered by existing library.")
>
> Slot released. Team cleaned up.

**Spec mode:**

> Drove via `slot-<persona>`.
>
> <driver's final-result one-liner>
>
> Snippet-author wrote N snippet(s):
>   - <name1> — <description>
> (or: "Snippet-author wrote 0 snippets — drive's work was covered by existing library.")
>
> Spec-writer wrote `<name>.spec.ts` composing <list of snippets> and asserting <one-liner>.
> (or: "Spec-writer updated `<name>.spec.ts` in place" / "No new spec — existing one covers this.")
>
> Spec-verifier ran `<name>.spec.ts` against `slot-<persona>` — **passed** in <duration>.
> (or: "Spec-verifier ran spec, FAILED after 3 iterations — escalated. See <details>.")
>
> Slot released. Team cleaned up.
>
> To record this spec for evidence (e.g. before/after a bug fix), run `/forge run <name>, record as <label>`.

If anything didn't go to plan (a teammate returned `cannot-drive`, the spec-verifier escalated, snippet invocation failed mid-drive, etc.), surface that prominently — the user wants the truth, not a sanitized success report.

## Hard rules

- **You are an orchestrator, not an actor.** All browser driving belongs to `driver`. Snippet authoring belongs to `snippet-author`. Spec writing belongs to `spec-writer`. Spec verification belongs to `spec-verifier`. You set up the team, create tasks, spawn teammates, manage the lifecycle, AND **handle the user channel**: STUCK messages from teammates → AskUserQuestion → SendMessage the answer back. You do NOT invoke `playwright-cli` yourself, write snippet or spec files, run specs, or message-relay between teammates EXCEPT for STUCK-response (that's deliberately you relaying user input).
- **Teammates message each other directly.** Don't parse driver messages and forward to snippet-author — they're already addressed to snippet-author directly. You only handle messages explicitly addressed to `team-lead`.
- **Always release the slot.** Even if the drive returned `cannot-drive` or a teammate rejected shutdown, eventually call `forge-pool-release.sh`. Leaving a slot perpetually checked out wastes capacity.
- **Always TeamDelete.** Don't leave team config files lying around in `~/.claude/teams/`.
- **One team at a time per session.** If a previous `/forge` invocation didn't clean up, `TeamDelete()` first before `TeamCreate`. (Claude Code allows only one active team per lead session.)
- **Provisioning recipe is the source of truth for slot creation.** Execute literally from the hint — don't invent fields.

## Failure modes to recover from

- **`TeamCreate` fails because a team already exists.** Call `TeamDelete()` first, then retry. (Note: `TeamDelete` fails if active teammates exist — you may need to shut them down first via SendMessage.)
- **`forge-pool-claim.sh` keeps returning EXHAUSTED even after provisioning.** The provisioning recipe may have a bug — look at the slot dir to confirm everything's in place. Surface to user if you can't diagnose.
- **Driver returns `cannot-drive` before doing meaningful work.** Snippet-author has nothing to author. Mark snippet-author's task complete with note "drive failed; no work to author"; proceed to shutdown and cleanup.
- **A teammate goes idle and never responds to your SendMessage.** It may have errored mid-turn. Try a follow-up nudge. If still no response, surface to user with the team's current state.
