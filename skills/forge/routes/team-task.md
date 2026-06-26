# /forge — team-task reference (base, drive mode)

This reference is loaded by `/forge`'s router for the **task**, **spec**, and **teach** routes. The router has already:

- Decided `MODE` (one of `drive` | `spec`) — the teach route uses `drive`
- Decided `COLLABORATIVENESS` (one of `autonomous` | `light-touch` | `guided` | `step-by-step`, default `autonomous`) — `step-by-step` for the teach route (the user is teaching forge a quirky flow), `guided` for a task the user asked to be walked through, `autonomous` otherwise. See `collaborativeness.md`.
- Stripped any leading `spec` / `teach` keyword from the task description
- Resolved `PLUGIN_ROOT` to the plugin's install path (see SKILL.md phase 1.0)

**Teach is a posture, not a separate mode.** The teach route is just `MODE=drive` at `COLLABORATIVENESS=step-by-step` — the same two teammates and lifecycle, with the driver going step-by-step *with* the user so quirks they know get baked into snippets. There is no separate teach agent pair; everything below applies, and the collaborativeness handling in Phase 4.0a is the only addition.

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below is a placeholder — substitute the literal path captured by the router. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in the bash context that runs from this reference.

**If `MODE=spec`, also load `team-task-spec.md`** — it adds spec-intent establishment, threads `SPEC_INTENT` into the driver-worker spawn, and gives the spec-mode report shape. Otherwise skip; this base file is sufficient for drive mode.

Below is the full lifecycle for running forge's **two teammates** against an ephemeral chromium session:

- **`driver-worker`** — drives the browser and, in spec mode, composes a spec from its own verbatim trace, verifies it cold, and self-fixes.
- **`snippet-curator`** — runs concurrently, watches the driver's action-stream (its on-disk transcript), and owns the snippet library: authoring, patching, splitting.

They coordinate **directly** via SendMessage (the driver signals chunk-complete / drive-complete / patch-request; the curator replies snippets-ready / patched — full vocabulary in `protocols/signals.md`). You are the **team lead**: you manage lifecycle (session, tasks, shutdown, cleanup) and own the **user channel**. You do **not** relay the peer-to-peer signals between them — those are direct.

Drive-mode lifecycle at a glance:

| Step | drive mode |
|---|---|
| Tasks created in phase 2.1 | 2 (driver-worker, snippet-curator) |
| Teammates spawned in phase 3 | 2 |
| Completion pings to wait for in phase 4 | 2 |
| Final report | "drove the task + library updated" |

Spec mode threads a spec intent and extends the final report — see the spec addendum. The teammate count stays **two** in both modes.

## Prerequisite

The forge teammates run as **teammates** (not backgrounded sub-agents) so the main conversation stays interactive, you can relay the user's mid-run steering, and the two can message each other. That requires agent teams, gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. When the flag isn't set, the first `Agent(...)` call below will fail with an explicit message. Relay the remedy to the user:

> /forge requires experimental agent teams. Enable by adding `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` to `~/.claude/settings.json` (or set the env var in your shell) and restart Claude Code.

Then stop.

The team auto-forms when the first teammate spawns — no `TeamCreate` call needed. The team directories at `~/.claude/teams/session-<8-char>/` and `~/.claude/tasks/session-<8-char>/` are created automatically and removed on session exit. The task list persists until `cleanupPeriodDays` elapses. The split is deliberate: spec composition stays in the driver's context (verbatim trace, no fidelity leak), while snippet curation runs concurrently in its own focused mind (so it survives interruption and patches continuously).

## Phase 1 — Discovery and setup

### 1.1. Find the project's forge root

```bash
node <PLUGIN_ROOT>/scripts/forge-find-root.mjs
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge init`. Capture as `FORGE_ROOT`.

### 1.2. Load the forge.md hint (lead-only)

```bash
cat <FORGE_ROOT>/hints/forge.md 2>/dev/null || echo ""
```

You need `forge.md` for persona/account resolution and the optional setup/teardown sections (Phases 1.4 and 5.3). The role hints (`driver.md`, `snippet-author.md`, `spec-writer.md`, `spec-verifier.md`) are read by the teammates themselves. Empty string is fine.

All hints are optional. A bare `/forge init` scaffold drives correctly; hints encode project-specific knowledge the teammates can't derive from the app.

### 1.2a. Load the escalation protocol (lead-only)

```bash
cat <PLUGIN_ROOT>/protocols/escalation.md
cat <PLUGIN_ROOT>/protocols/collaborativeness.md
```

`escalation.md` — you route the driver's check-ins per its **Lead side** (§3); loading it keeps the protocol and message shapes a single source of truth shared with the driver (it `cat`s the same file on friction). `collaborativeness.md` — you read the **deference** column to know how readily to involve the user at this run's `COLLABORATIVENESS` level, and you hold/step that level through the run.

### 1.3. Generate a session name

```bash
echo "ft-$(node -e 'console.log(require("crypto").randomBytes(4).toString("hex"))')"
```

Capture as `SESSION_NAME`. The driver uses it to launch/reference the browser; phase 5 uses it to close it.

### 1.3a. Check cleanup staleness (silent — surface at end)

```bash
cat <FORGE_ROOT>/.last-cleanup 2>/dev/null || echo ""
```

JSON `{ "hints": "<ISO>", "snippets": "<ISO>" }`. Compute days-since. Capture `CLEANUP_NUDGE` as:
- **empty** if the file is missing and `forge/hints/` + `forge/snippets/` are sparse (under ~3 files combined).
- **`hints` / `snippets` / `both`** if the file is missing on a non-sparse project, or a timestamp is older than 7 days.

Hold for Phase 5.5. **Do not surface now.**

### 1.4. Apply setup instructions (optional)

If `forge.md` has a `## Setup before each run` section, follow it literally (SQL seeding, account-reset endpoint, mint a test user, "don't reset anything"). If absent, skip. If setup captures values (minted credentials), hold them and pass to the driver via the spawn prompt or the env contract in `forge.md`. If setup fails, surface to the user and stop.

## Phase 2 — Create the tasks

The team auto-forms when the first teammate spawns. Skip straight to task creation.

```
TaskCreate(
  subject="forge driver: <USER_TASK>",
  description="Drive the user's browser task end-to-end via playwright-cli session <SESSION_NAME>, scanning <FORGE_ROOT>/snippets/ and invoking matching snippets; signal each meaningful chunk to snippet-curator. MODE=<MODE>: in spec mode, after the curator sends snippets-ready, compose a self-contained .spec.ts in <FORGE_ROOT>/specs/ from the drive's own verbatim trace, run it cold via forge-run-spec.mjs, and self-fix (routing snippet-level fixes to the curator). Claim with TaskUpdate(status='in_progress') at start; keep in_progress through the whole run; TaskUpdate(status='completed') at the final report."
)
# Note as DRIVER_TASK_ID.

TaskCreate(
  subject="forge snippet-curator: <USER_TASK>",
  description="Watch the driver-worker's action-stream (its transcript) and curate <FORGE_ROOT>/snippets/ in real time — author/patch/split from the driver's VERBATIM trace, triggered by its chunk signals. On drive-complete, finish + send snippets-ready. Stay alive through the driver's spec-verify loop to handle patch-requests. Claim with TaskUpdate(status='in_progress') at start; keep in_progress until the driver's run resolves; TaskUpdate(status='completed') at your completion ping."
)
# Note as CURATOR_TASK_ID.
```

Don't set ownership — each teammate self-claims via `TaskUpdate(taskId=<id>, status="in_progress")`; the spawn prompt names its task ID.

**If MODE == spec**, establish the spec intent first — see `team-task-spec.md` Phase 2.0. Capture `SPEC_INTENT`.

## Phase 3 — Spawn the two teammates

Spawn as **teammates** — no `run_in_background` (a teammate already keeps you non-blocked and reachable, and gets a watchable pane under `teammateMode: auto`). Spawn the **driver first** so the team forms and you can read its team name, then the curator.

```
Agent(
  description="Forge <MODE> drive: <short USER_TASK>",
  subagent_type="forge:driver-worker",
  name="driver-worker",
  prompt="MODE: <MODE>
COLLABORATIVENESS: <COLLABORATIVENESS>
SESSION_NAME: <SESSION_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
CURATOR_NAME: snippet-curator
USER_TASK: <user's task verbatim>
<if MODE == spec, include:> SPEC_INTENT: <regression | repro | scenario>  (for repro: the bug claim to assert as correct behavior)

Your task ID is <DRIVER_TASK_ID>. Claim it with TaskUpdate(taskId=<DRIVER_TASK_ID>, status='in_progress'), read your hints, and begin. Signal each meaningful chunk to snippet-curator. When the run is finished, TaskUpdate(status='completed') and ping team-lead."
)
```

The spawn response carries the agent id as `driver-worker@<TEAM_NAME>` (e.g. `session-36180256`). **Capture `<TEAM_NAME>`** — the curator needs it to locate the driver's transcript. Then:

```
Agent(
  description="Forge <MODE> curator: <short USER_TASK>",
  subagent_type="forge:snippet-curator",
  name="snippet-curator",
  prompt="MODE: <MODE>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
DRIVER_NAME: driver-worker
TEAM_NAME: <TEAM_NAME>
USER_TASK: <user's task verbatim>

Your task ID is <CURATOR_TASK_ID>. Claim it with TaskUpdate(taskId=<CURATOR_TASK_ID>, status='in_progress'), read your hints, and wait for the driver's first chunk signal. The driver may begin before you're ready — its transcript is your backstop, so read forward from the start to catch any early chunks."
)
```

`description` is required by the Agent tool — keep it short.

## Phase 4 — Wait for both teammates, relay the user

After spawning, the teammates self-coordinate (the chunk/drive-complete/snippets-ready/patch-request signals flow **directly** between them — you don't relay those). You wait for **two** completion pings and stay available to the user.

**What to watch for:**

- **Completion pings** — `driver-worker` pings `team-lead` when its run is done; `snippet-curator` pings when the library work (and, in spec mode, the verify-patch window) has resolved. Proceed to phase 5 only after **both**.
- **Messages addressed to you (`team-lead`)**:
  - **check-in** (usually from the driver) — `CHECK-IN` / `STUCK ON:` / `TEMPTED TO:` / optional `HUNCH:`. The driver has hit friction and handed *you* the routing rather than classifying it or reaching outside the browser. **Route it per `escalation.md` §3 (Lead side)**, loaded in Phase 1.2a: answer from the code (read-only — `Glob`/`Grep`/`Read`/`Explore`), hand a concrete steer, take it to the user (`AskUserQuestion` → relay), or offer a teach walk-through (→ 4.0a). The message shapes and reply vocabulary live there; the driver is idle until you reply, so route promptly.
  - **`cannot-drive`** from the driver — terminal failure. Surface in the report; proceed to cleanup.
  - **Status / questions** — answer concisely or relay context.
- **The user steers mid-run** — relay it to the **driver**: `SendMessage(to="driver-worker", summary="steer", message="<the user's instruction>")`. Relay promptly so it lands at the driver's next turn boundary. (Library/snippet steers go to `snippet-curator` instead.)
- **Idle notifications** — informational; they fire after every turn. Treat the `task <id> complete` pings as authoritative.

> **Note on `TaskList()`:** calling it from the lead does NOT surface team tasks reliably. Treat the completion pings as authoritative; don't gate phase 5 on TaskList.

### 4.0a. Collaborativeness (deference + teaching)

`COLLABORATIVENESS` (one of `autonomous` | `light-touch` | `guided` | `step-by-step`, default `autonomous`; see `collaborativeness.md`, loaded in 1.2a) sets how readily you bring the user in — you read its **deference** column. At `autonomous` you resolve check-ins yourself wherever you can (asking the user only when *you're* stuck — the floor); each rung up routes more to the user; at `step-by-step` the driver surfaces every step and you carry a step-by-step teaching conversation. You **hold the level and step it mid-run** on the user's framing — "walk me through this next bit" → up a rung; "you can take it from here" → back to `autonomous`. A driver check-in (Phase 4) is also a natural cue to *offer* a walk-through and step up on a yes.

When collaborativeness is high you're an **active interlocutor**, not a passive ping-waiter:

- **Surface the driver's check-ins conversationally.** When the driver messages you "about to <step> — anything to flag?", relay it to the user as plain conversation (not `AskUserQuestion` — teaching is free-form). Pass the user's reply back: `SendMessage(to="driver-worker", summary="steer", message="<go-ahead | the gotcha to fold in | the correction>")`.
- **Relay the cadence change when you nudge the dial.** *"walk me through this next bit"* → `SendMessage(to="driver-worker", summary="cadence", message="collaborate from here — surface each step and wait for the user")`; *"you can take it from here"* → `…message="autonomous from here — drive on your own"`. A normal drive can enter teaching this way and leave it just as easily.
- **Takeover.** *"I'll take the wheel"* / *"let me set up some state"* → `SendMessage(to="driver-worker", summary="takeover", message="user is driving the browser directly — go idle until they hand back")`. When the user returns, ask where they ended up if they don't volunteer it, then relay the grounding: `…summary="resume", message="user handed back. Current state: <their grounding, verbatim>. Resume from here."`
- **Relay library steers to the curator.** Naming / boundary / structure direction — *"cap that as `login-with-sso`"*, *"split this one"*, *"make `item` an arg"* — goes to `snippet-curator`, not the driver: `SendMessage(to="snippet-curator", summary="library steer", message="<the user's direction>")`.

The lifecycle is otherwise unchanged — two teammates, two completion pings, the same Phase 5 shutdown. Collaborativeness is a *disposition* layered on the normal flow, not a separate path.

### 4.1. Idle-notification stall watchdog

A teammate that finished but forgot to ping appears as idle notifications with no completion summary. For each teammate you're still awaiting, keep a counter of consecutive bare idle notifications (a peer-DM summary resets it). At 3, nudge that teammate once:

```
SendMessage(to="<teammate>", summary="status check", message="What's your status — done? If finished, SendMessage team-lead a completion summary so we can shut down.")
```

If it responds with a completion summary, treat it as the missing ping. If 2 more idle notifications arrive with no response, inspect on-disk artifacts (`ls <FORGE_ROOT>/snippets/`, `ls <FORGE_ROOT>/specs/`), surface state to the user, and proceed to Phase 5 — **the chromium close in 5.4 runs regardless of the missing ping** (a dangling teammate must never strand the browser). **Bounded waiting:** if 10+ minutes pass without both pings AND no check-in/cannot-drive, surface to the user and proceed to Phase 5 anyway.

## Phase 4.5 — Review hint proposals (on-demand)

Each completion ping ends with `proposals: <N>`. If **both** are `proposals: 0`, skip this phase entirely. If either is `> 0`, wait for its `PROPOSALS` SendMessage(s), capture verbatim, then:

```bash
cat <PLUGIN_ROOT>/protocols/proposals.md
```

Follow its **§3 (Lead side)** for aggregation, user review, and application. Hold the "Hint files updated" summary for Phase 5.5.

## Phase 5 — Shut down and clean up

A run can end several ways — normally both completion pings; also via the stall watchdog (4.1), a `cannot-drive`, or a user abort. **However it ends, you reach this phase and the chromium close (5.4) always runs** — you generated `SESSION_NAME` in 1.3 and own it, so you are the guaranteed backstop for the browser. The steps below describe the normal both-pings path; the other endings route here too and still execute 5.4.

In the normal case — once **both** completion pings have arrived:

### 5.1. Request shutdown (both teammates)

For each of `driver-worker` and `snippet-curator`:

```
SendMessage(to="<teammate>", summary="team work complete; shutdown", message={"type": "shutdown_request", "reason": "team work done"})
```

Wait for each `{"type": "shutdown_response", "approve": true, ...}`. The response includes a `paneId` (e.g. `"%105"`) when the backend is tmux — capture each for pane cleanup. If a teammate rejects, surface the reason.

### 5.2. Kill the leftover tmux panes

```bash
tmux kill-pane -t <paneId>
```

Once per teammate, using the `paneId` from each `shutdown_response`. Best-effort; skip if no `paneId`.

### 5.3. Apply teardown instructions (optional)

Execute any `## Teardown after each run` section in `forge.md`. If absent, skip.

### 5.4. Close the chromium session

```bash
playwright-cli -s=<SESSION_NAME> close
```

**This always runs — gated on nothing.** You generated `SESSION_NAME` in 1.3 and the driver only ever (re)opens under it, so closing by that name reliably catches the live browser however the run ended — both pings, a watchdog timeout, `cannot-drive`, a rejected shutdown, or a user abort. Best-effort; fall back to killing the process tree if it survives. The driver may have already closed it — a no-op then.

### 5.5. Report to the user

Compose a tight summary. Drive-mode shape:

> <driver's final-result one-liner>
>
> Library: curator wrote N new (<names>), patched M (<names>), split K (<names>) — or "no changes — covered by the existing library".
>
> Hint files updated: <one line per file>.
> (Omit this header if no proposals were surfaced or all were rejected.)
>
> Browser session closed.

For a **high-collaborativeness / teach** run, lead with the library line — the curated snippets (with the user's taught gotchas baked in) are the headline, not the drive result.

In spec mode, use the extended shape in `team-task-spec.md` Phase 5.5 — it adds the spec + verification line.

If anything didn't go to plan (`cannot-drive`, a spec parked unverified, snippet invocation failed mid-drive, etc.), surface prominently — the user wants the truth.

### 5.5a. Append cleanup nudge (if captured in 1.3a)

If `CLEANUP_NUDGE` is non-empty, append a one-line tail:
- `hints` — *"Last hint cleanup was N days ago — consider `/forge clean hints`."* ("never" if no staleness file.)
- `snippets` — *"Last snippet cleanup was N days ago — consider `/forge clean snippets`."*
- `both` — *"Hints and snippets haven't been cleaned in over a week — consider `/forge clean`."* (Or *"No record of any forge cleanup — consider `/forge clean` to baseline."*)

Non-blocking, once-per-run. Don't repeat if the user already cleaned this session.

## Hard rules

- **You are an orchestrator and the routing tier — not an actor on the app.** All browser driving, spec writing, and spec running belong to `driver-worker`; all snippet authoring/patching to `snippet-curator`. You set up the team, create the tasks, spawn the two teammates, manage lifecycle, AND own the user channel and the driver's **check-ins**: you decide whether a check-in is answered from the code (read-only research — `Glob`/`Grep`/`Read`/`Explore`), with a concrete steer, or by the user (`AskUserQuestion` → SendMessage back); you relay user steering to the relevant teammate. That read-only research is the one thing you reach for beyond orchestration; you still never invoke `playwright-cli`/`forge-pw`, drive the browser, write snippet or spec files, run specs, or mutate the app or its environment.
- **The peer signals are direct — don't relay them.** chunk-complete / drive-complete / snippets-ready / patch-request flow between the driver and curator. You only handle messages addressed to `team-lead`.
- **High collaborativeness makes you an active interlocutor.** `COLLABORATIVENESS` sets how readily you involve the user; at `guided`/`step-by-step` you carry the teaching conversation — relay the driver's per-step check-ins as plain conversation, pass guidance back, step the level and relay library steers on request (Phase 4.0a). The lifecycle is unchanged: still two teammates, two pings, the same Phase 5.
- **The verify loop lives inside the driver.** In spec mode the driver runs its spec cold, diagnoses, fixes spec-logic inline, and routes snippet-level fixes to the curator via patch-request. You don't triage or route snippet/spec fixes — but you field the driver's check-ins (route them: a steer, read-only investigation of the code, or take it to the user), and relay user steers.
- **Wait for BOTH pings before shutdown.** The curator stays alive through the driver's verify loop (for patch-requests); it pings complete only after the run resolves. Don't shut anyone down early.
- **Always close the chromium session — on every exit path.** Both pings, a watchdog timeout, `cannot-drive`, a rejected shutdown, or a user abort all still reach 5.4. You own `SESSION_NAME`; a run never ends with the browser left open.
- **`forge.md` is the source of truth for test-account / credential resolution.** Don't invent accounts or hardcode credentials.

## Failure modes to recover from

- **`Agent(...)` fails because agent teams aren't enabled** → surface the Prerequisite remedy and stop.
- **Driver returns `cannot-drive` early** → surface; proceed to cleanup (the curator likely has nothing to author — let it wrap up).
- **A teammate goes idle and never responds** → nudge (4.1); if still silent, surface state and proceed to close the session.
- **Credentials missing** → driver checks in on an empty env key; surface the missing key to the user.
