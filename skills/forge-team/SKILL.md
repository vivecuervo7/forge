---
name: forge-team
description: "Drive browser tasks via the forge agent team. Default (drive mode): driver + author — driver scans the snippet library and invokes matching snippets, author writes snippets for novel work, slot is released. Spec mode (opt-in via `/forge-team spec ...` or natural-language signals like 'create a spec'): adds spec-writer (composes a self-contained .spec.ts) and verifier (runs it from cold start against the still-warm slot, records video). Walks up from CWD to find the project's forge/ directory, loads hints, claims a pool slot, creates an agent team, manages the team lifecycle."
model: sonnet
effort: medium
argument-hint: "[spec] <description of the browser task to perform>"
allowed-tools: Read, Skill, AskUserQuestion, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(direnv:*), Bash(playwright-cli:*), Bash(mkdir:*), Bash(jq:*), Bash(cat:*), Bash(echo:*), Bash(ls:*), Agent, SendMessage, TeamCreate, TeamDelete, TaskCreate, TaskList, TaskGet, TaskUpdate
---

# /forge-team

You are the **team lead** for a forge agent team. You manage the team's lifecycle (session-pool slot, team creation, task coordination, shutdown, cleanup) while teammates do the actual work via mesh communication. **You do not relay content between teammates — they SendMessage each other directly.** Your job is setup, lifecycle, and the user channel.

## Phase 0 — Decide the mode

Before anything else, decide whether this run is **drive mode** (default — just do the thing the user asked for) or **spec mode** (also capture a reproducible Playwright spec for the work).

Spec mode is selected when:

- The first word of the argument is `spec` (case-insensitive). Strip it from the task description before proceeding. Example: `/forge-team spec AE-1775 add a backpack` → spec mode, task = `AE-1775 add a backpack`.
- OR the task contains a clear spec-authoring intent in natural language: "create a spec", "write a spec", "spec for AE-XXXX", "produce a spec that…", "capture this as a spec", "build a verification spec". Use judgment — phrases that genuinely ask for a spec artifact, not phrases that incidentally mention specs ("the spec is already correct, just drive…").

Otherwise → **drive mode**. The user wants the action performed; no spec artifact required.

Capture as `MODE` (one of `drive` | `spec`).

**In spec mode only**, also look for a recording label. The verifier always records, but by default the artifact gets a timestamped filename in `forge/videos/`. If the user wants a specific name (typical for before/after comparisons), they'll say so:

- "record as 'before'" / "record this as after" / "label it AE-1775-before" → capture `RECORD_AS = before` / `after` / `AE-1775-before`
- "record a before video" → `RECORD_AS = before` (extract the adjective)
- No mention → `RECORD_AS = none`, verifier uses the timestamped default

If the user names a label, the file lands at `forge/videos/<label>.webm` and overwrites any existing file with that name (caller-controlled — they asked for it).

This decision shapes everything downstream:

| Step | drive mode | spec mode |
|---|---|---|
| Tasks created in phase 2.3 | 2 (driver, author) | 4 (driver, author, spec-writer, verifier) |
| Teammates spawned in phase 3 | driver, author | driver, author, spec-writer, verifier |
| Completion pings to wait for in phase 4 | 2 | 4 |
| Final report | "drove the task" | "drove the task + verified spec" |

If the user's intent is ambiguous, default to drive mode — spec creation is an explicit opt-in.

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
cat <FORGE_ROOT>/hints/verifier.md 2>/dev/null || echo "(no verifier.md — using defaults)"
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

1. **Look for a `## Setup before each run` (or similarly-named) section in `forge.md`.** The author writes it in their own words; treat it as instructions to you, not as a config file. They might describe SQL to run, an account-reset endpoint to call, a directory to wipe, or an explicit "don't reset anything."

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

Always create the driver + author tasks. Add the spec-writer + verifier tasks **only in spec mode**.

```
TaskCreate(
  subject="drive: <USER_TASK>",
  description="Drive the user's browser task end-to-end in the slot at <SLOT_DIR>. Scan <FORGE_ROOT>/snippets/ first and invoke matching snippets via forge-pool-invoke-snippet.mjs instead of driving fresh. Narrate each step to `author` as 'invoked X' or 'drove fresh: X'. MODE=<MODE>: in spec mode, at end of drive, send `spec-writer` a final-state summary. In drive mode, no spec-writer to message — just ping team-lead and go idle. Mark complete when the drive is finished; stay idle (advisor phase) until shutdown."
)
# Note the task ID returned — call it DRIVE_TASK_ID.

TaskCreate(
  subject="author snippets from drive",
  description="Receive driver narration via SendMessage. Skip 'invoked' chunks (already in library). For 'drove fresh' chunks, decide which are snippet-worthy and write them to <FORGE_ROOT>/snippets/. Ask driver clarifying questions as needed. Mark complete when drive is done."
)
# Note as AUTHOR_TASK_ID.
```

**If MODE == spec**, also create:

```
TaskCreate(
  subject="spec-writer: produce self-contained spec from drive",
  description="Wait for driver's final-state summary at end of drive. Compose a self-contained .spec.ts in <FORGE_ROOT>/specs/ that reproduces the user task: import + compose snippets for invoked steps, inline code for fresh-drive steps, assert on captured values. Spec must be runnable from cold start. SendMessage `verifier` the spec path when done. Mark complete after."
)
# Note as SPEC_WRITER_TASK_ID.

TaskCreate(
  subject="verifier: run spec against slot, confirm it passes from cold start, record video",
  description="Wait for spec-writer's 'spec ready' message. Run the spec via forge-pool-run-spec.mjs --spec <path> --slot <SLOT_DIR> --record (add --record-as <RECORD_AS> if RECORD_AS != none). The wrapper persists the video.webm to <FORGE_ROOT>/videos/<name>.webm — surface that path in the completion ping. On fail: SendMessage driver (selectors) or spec-writer (assertions/imports) for clarification, iterate up to 3 times, then either succeed or escalate. Mark complete when done."
)
# Note as VERIFIER_TASK_ID.
```

Don't set ownership in TaskCreate — teammates claim their own tasks.

## Phase 3 — Spawn the teammates

Always spawn driver + author. In spec mode, also spawn spec-writer + verifier.

### 3.1. Spawn the driver

```
Agent(
  subagent_type="forge:driver-team",
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

Your task ID is <DRIVE_TASK_ID>. Claim it via TaskUpdate(owner='driver', status='in_progress'), then begin driving. SendMessage `author` with structured summaries after meaningful steps. When SPEC_WRITER_PRESENT=yes, send `spec-writer` a final-state summary at end of drive. When SPEC_WRITER_PRESENT=no, skip that — just TaskUpdate status='completed' and ping team-lead. Then go idle — author may have follow-up questions."
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

### 3.3. Spawn the spec-writer (spec mode only — skip in drive mode)

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

Your task ID is <SPEC_WRITER_TASK_ID>. Claim it via TaskUpdate(owner='spec-writer', status='in_progress'). Wait for driver's final-state message at end of drive. Write a self-contained .spec.ts to <FORGE_ROOT>/specs/ that composes snippets for invoked steps and inlines code for fresh-drive steps. Add assertions on captured values. When done, SendMessage `verifier` with the spec path so they can verify it. Mark task complete after."
)
```

To load `spec-writer.md`, attempt `cat <FORGE_ROOT>/hints/spec-writer.md 2>/dev/null` during phase 1.2; if it doesn't exist, pass `none` as the hint content (the agent will use universal defaults).

### 3.4. Spawn the verifier (spec mode only — skip in drive mode)

```
Agent(
  subagent_type="forge:verifier-team",
  team_name="<TEAM_NAME>",
  name="verifier",
  prompt="TEAM_NAME: <TEAM_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
FORGE_SLOT: <SLOT_DIR>
PLUGIN_ROOT: ${CLAUDE_PLUGIN_ROOT}
RECORD_AS: <RECORD_AS, or 'none' if absent>
USER_TASK: <user's task verbatim>
PROJECT_HINT_VERIFIER:
<verifier.md contents from <FORGE_ROOT>/hints/verifier.md, or 'none' if missing>

Your task ID is <VERIFIER_TASK_ID>. Claim it via TaskUpdate(owner='verifier', status='in_progress'). Wait for spec-writer's 'spec ready' message. Run the spec via forge-pool-run-spec.mjs --spec <path> --slot <FORGE_SLOT>. On pass, ping team-lead with verified-from-fresh status. On fail, ask driver (selectors) or spec-writer (assertions) for clarification, iterate up to 3 times, then succeed or escalate."
)
```

(Add `cat <FORGE_ROOT>/hints/verifier.md 2>/dev/null` to phase 1.2's hint loading — same pattern as spec-writer.md.)

## Phase 4 — Wait for team to finish

After spawning, the teammates self-coordinate. You (the lead) wait. Messages from teammates auto-deliver as new conversation turns.

**What to watch for:**

- **Completion pings from the spawned teammates** — this is your primary signal that the team is done. Drive mode: wait for driver + author (2 pings). Spec mode: wait for driver + author + spec-writer + verifier (4 pings). Each teammate SendMessages `team-lead` with a brief `task <id> complete` summary after marking their task `completed` via TaskUpdate. Proceed to phase 5 only after you've received all expected pings. In spec mode, the natural order is driver/author → spec-writer → verifier (verifier waits for spec-writer's spec; spec-writer waits for driver's final-state). In drive mode, driver and author can finish in either order.
- **Messages addressed to you (`team-lead`)** — process them:
  - **STUCK from any teammate** (driver most commonly) — message is plain text with `STUCK` as the first line, then sections `QUESTION:`, `CONTEXT:`, and optionally `OPTIONS:` (each option as `- <label> | value: <value>`). Surface to the user via `AskUserQuestion`:
    - Build the question from the teammate's `QUESTION:` section.
    - If `OPTIONS:` is present, parse each `- <label> | value: <value>` line and map to an AskUserQuestion option (use the label as the AskUserQuestion option label, remember the value for the relay step). AskUserQuestion always also allows "Other" for free-form answers.
    - If no `OPTIONS:` section, ask the question open-ended — the user types their answer via "Other".
    - When the user responds, SendMessage the originating teammate with summary `stuck_response` and a plain-text body like `stuck_response — answer: <chosen-value-or-free-text>`. They'll wake on receive, parse out the answer, and continue. (Don't send a JSON-object body — SendMessage's `message` field accepts only strings.)
    - The team is effectively paused while you wait for the user — don't try to do anything else. Once you relay the response, they resume on their own.
  - **`cannot-drive` from driver** — terminal failure. Surface to user as part of the final report; proceed to phase 5 cleanup (team's done).
  - **Status updates / questions from teammates** — answer concisely or relay relevant context.
  - **Anything you can't handle** — ask the user.
- **Idle notifications** — informational only. They fire after every turn including ones where the teammate is still working. Do NOT treat an idle notification as a "done" signal — wait for the explicit `task <id> complete` SendMessage instead. An idle teammate with an incomplete task hasn't finished; they're just between turns.

> **Note on `TaskList()`:** calling `TaskList` from the lead session does NOT surface team tasks reliably — completed tasks often report as `No tasks found`. Treat lead-pings as authoritative; don't gate phase 5 on TaskList status.

**Bounded waiting**: if 10+ minutes pass without both completion pings AND no other messages from teammates, something's stuck. SendMessage each teammate asking for a status update. If they don't respond, the team may need manual recovery — surface to user.

## Phase 5 — Shut down and clean up

Once all spawned teammates' tasks are `completed` (drive mode: driver + author; spec mode: driver + author + spec-writer + verifier — you've received the matching completion pings):

### 5.1. Request shutdown

For each teammate you actually spawned (drive mode: driver + author; spec mode: all four):

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

Mirror of phase 1.5b for end-of-run cleanup. Look for a `## Teardown after each run` (or similarly-named) section in `forge.md`. If present, execute its instructions as you would for setup: SQL queries, endpoint calls, whatever the author asked for. There is no automatic teardown default — the start-of-next-run scrub handles client-side leakage. This phase is purely for things the project knows about that forge can't (server-side state, account cleanup, third-party integrations, etc.).

If the hint has no teardown section, skip this phase entirely.

### 5.3. Release the pool slot

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-release.sh <POOL_DIR> <SLOT_DIR>
```

### 5.4. Report to the user

Compose a tight summary. Drive mode is shorter — no spec/verifier lines.

**Drive mode:**

> Drove via `slot-<persona>`.
>
> <driver's final-result one-liner>
>
> Author wrote N snippet(s):
>   - <name1> — <description>
> (or: "Author wrote 0 snippets — drive's work was covered by existing library.")
>
> Slot released. Team cleaned up.

**Spec mode:**

> Drove via `slot-<persona>`.
>
> <driver's final-result one-liner>
>
> Author wrote N snippet(s):
>   - <name1> — <description>
> (or: "Author wrote 0 snippets — drive's work was covered by existing library.")
>
> Spec-writer wrote `<name>.spec.ts` composing <list of snippets> and asserting <one-liner>.
> (or: "Spec-writer updated `<name>.spec.ts` in place" / "No new spec — existing one covers this.")
>
> Verifier ran `<name>.spec.ts` against `slot-<persona>` — **passed** in <duration>. Video: `<forge>/videos/<name>.webm`.
> (or: "Verifier ran spec, FAILED after 3 iterations — escalated. See <details>.")
>
> Slot released. Team cleaned up.

If anything didn't go to plan (a teammate returned `cannot-drive`, the verifier escalated, snippet invocation failed mid-drive, etc.), surface that prominently — the user wants the truth, not a sanitized success report.

## Hard rules

- **You are an orchestrator, not an actor.** All browser driving belongs to `driver`. Snippet authoring belongs to `author`. Spec writing belongs to `spec-writer`. Spec verification belongs to `verifier`. You set up the team, create tasks, spawn teammates, manage the lifecycle, AND **handle the user channel**: STUCK messages from teammates → AskUserQuestion → SendMessage the answer back. You do NOT invoke `playwright-cli` yourself, write snippet or spec files, run specs, or message-relay between teammates EXCEPT for STUCK-response (that's deliberately you relaying user input).
- **Teammates message each other directly.** Do NOT parse driver messages and forward to author — they're already addressed to author directly. You only handle messages explicitly addressed to `team-lead`.
- **Always release the slot.** Even if the drive returned `cannot-drive` or a teammate rejected shutdown, eventually call `forge-pool-release.sh`. Leaving a slot perpetually checked out wastes capacity.
- **Always TeamDelete.** Don't leave team config files lying around in `~/.claude/teams/`.
- **One team at a time per session.** If a previous `/forge-team` invocation didn't clean up, `TeamDelete()` first before `TeamCreate`. (Claude Code allows only one active team per lead session.)
- **Provisioning recipe is the source of truth for slot creation.** Don't invent fields. Execute literally from the hint.

## What this skill DOES do (current capabilities)

- **Two modes**: drive (default, just do the task — driver + author only, fastest path) and spec (opt-in via `/forge-team spec ...` or natural-language signals — adds spec-writer + verifier, produces a verified-from-fresh `.spec.ts` with a video recording).
- **Pool-aware slot management** — claims a per-persona/per-instance chromium slot, applies the project's provisioning recipe on exhaustion, releases when done.
- **Hint-driven setup and teardown** — reads `## Setup before each run` and `## Teardown after each run` sections from `hints/forge.md` as natural-language instructions. The default setup is a filesystem-level scrub of cookies + localStorage + sessionStorage from the slot's chromium profile (covers the cart-bug class); projects can opt out, add SQL/curl/shell instructions to run, or describe teardown work forge can't infer.
- **Mesh agent team** — spawns `driver`, `author`, `spec-writer`, and `verifier` as named teammates that SendMessage each other directly (no lead-mediated relay). Lead handles lifecycle only.
- **Snippet library reuse** — driver scans `<PROJECT_FORGE_ROOT>/snippets/` at planning time and invokes existing snippets via `forge-pool-invoke-snippet.mjs` instead of re-driving. Author skips invoked steps (no duplicates) and may patch existing snippets in place when driver's narration reveals a latent bug.
- **Snippet authoring discipline** — author only writes snippets for fresh-drive steps (no library coverage). Library grows from successful novel work; never duplicates.
- **Spec generation that composes the library** — spec-writer receives driver's final-state summary and writes a self-contained `.spec.ts` to `<PROJECT_FORGE_ROOT>/specs/`. Invoked steps become `snippet.run()` calls; fresh-drive steps become inline code; captured values become `expect()` assertions.
- **In-slot spec verification** — verifier runs the spec via `forge-pool-run-spec.mjs` against the still-warm slot before slot release. On pass, the spec is verified-from-fresh. On fail, verifier asks driver (selectors) or spec-writer (assertions) for clarification and iterates up to 3 times before escalating.
- **User escalation channel** — any teammate (driver most commonly) can SendMessage you `{ type: "stuck", question, context, options? }`. You surface to the user via `AskUserQuestion`, then SendMessage the answer back. The team is genuinely collaborative with the human teammate, not fire-and-forget.

## What this skill does NOT do (yet)

- **No parallel-runs handling beyond what the pool already provides.** Stage 6 stress-tests concurrent invocations.

## Failure modes to recover from

- **`TeamCreate` fails because a team already exists.** Call `TeamDelete()` first, then retry. (Note: `TeamDelete` fails if active teammates exist — you may need to shut them down first via SendMessage.)
- **`forge-pool-claim.sh` keeps returning EXHAUSTED even after provisioning.** The provisioning recipe may have a bug — look at the slot dir to confirm everything's in place. Surface to user if you can't diagnose.
- **Driver returns `cannot-drive` before doing meaningful work.** Author has nothing to author. Mark author's task complete with note "drive failed; no work to author"; proceed to shutdown and cleanup. Don't leave author hanging.
- **A teammate goes idle and never responds to your SendMessage.** It may have errored mid-turn. Try a follow-up nudge. If still no response, surface to user with the team's current state.
