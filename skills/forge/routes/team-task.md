# /forge — team-task reference (base, drive mode)

This reference is loaded by `/forge`'s router for the **task**, **spec**, and **teach** routes. The router has already:

- Decided `MODE` (one of `drive` | `spec`) — the teach route uses `drive`
- Decided `COLLABORATIVENESS` (one of `autonomous` | `light-touch` | `guided` | `step-by-step`, default `autonomous`) — `step-by-step` for the teach route (the user is teaching forge a quirky flow), `guided` for a task the user asked to be walked through, `autonomous` otherwise. See `collaborativeness.md`.
- Stripped any leading `spec` / `teach` keyword from the task description
- Resolved `PLUGIN_ROOT` to the plugin's install path (see SKILL.md phase 1.0)

**Teach is a posture, not a separate mode.** The teach route is just `MODE=drive` at `COLLABORATIVENESS=step-by-step` — the same two teammates and lifecycle, with the driver going step-by-step *with* the user so quirks they know get baked into snippets. There is no separate teach agent pair; everything below applies, and the collaborativeness handling in Phase 4.0a is the only addition.

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below is a placeholder — substitute the literal path captured by the router. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in the bash context that runs from this reference.

**If `MODE=spec`, also load `team-task-spec.md`** — it adds spec-intent establishment, threads `SPEC_INTENT` into the driver spawn, and gives the spec-mode report shape. Otherwise skip; this base file is sufficient for drive mode.

Below is the full lifecycle for running forge's **two teammates** against an ephemeral chromium session:

- **`driver`** — drives the browser and, in spec mode, composes a spec from its own verbatim trace, verifies it cold, and self-fixes.
- **`curator`** — runs concurrently, watches the driver's action-stream (its on-disk transcript), and owns the snippet library: authoring, patching, splitting.

They coordinate **directly** via SendMessage (the driver signals chunk-complete / drive-complete / patch-request; the curator replies snippets-ready / patched — full vocabulary in `protocols/signals.md`). You are the **team lead**: you manage lifecycle (session, tasks, shutdown, cleanup) and own the **user channel**. You do **not** relay the peer-to-peer signals between them — those are direct.

Drive-mode lifecycle at a glance:

| Step | drive mode |
|---|---|
| Tasks created in phase 2.1 | 2 (driver, curator) |
| Teammates spawned in phase 3 | 2 |
| Completion pings to wait for in phase 4 | 2 |
| Final report | "drove the task + library updated" |

Spec mode threads a spec intent and extends the final report — see the spec addendum. The teammate count stays **two** in both modes.

## Prerequisite

The forge teammates run as **teammates** (not backgrounded sub-agents) so the main conversation stays interactive, you can relay the user's mid-run steering, and the two can message each other. That requires agent teams, gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. When the flag isn't set, the first `Agent(...)` call below will fail with an explicit message. Relay the remedy to the user:

> /forge requires experimental agent teams. Enable by adding `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` to `~/.claude/settings.json` (or set the env var in your shell) and restart Claude Code.

Then offer to apply it rather than leaving the user to edit JSON by hand: `AskUserQuestion` — *"Add the setting to `~/.claude/settings.json` for you now?"* (Yes (Recommended) / No). On yes, `Read` `~/.claude/settings.json` and merge `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` into its `env` object — create the file or the `env` key if missing, preserve everything else — then confirm the edit and remind them: **restart Claude Code, then re-run the same `/forge` command.**

Either way, stop here — the run can't proceed without a restart.

The team auto-forms when the first teammate spawns — no `TeamCreate` call needed. The team directories at `~/.claude/teams/session-<8-char>/` and `~/.claude/tasks/session-<8-char>/` are created automatically and removed on session exit. The task list persists until `cleanupPeriodDays` elapses. The split is deliberate: spec composition stays in the driver's context (verbatim trace, no fidelity leak), while snippet curation runs concurrently in its own focused mind (so it survives interruption and patches continuously).

## Phase 1 — Preflight

### 1.1. Decide the run's shape (judgment first)

Two decisions are yours before anything runs:

**`SESSION_NAME`** — short + meaningful; it's how you (and the user) spot the session **at a glance in the Playwright dashboard** when several run at once. Use judgment:

- **Favor a ticket key** if the task or context has one (`PROJ-123` → `proj123`) — usually the most recognizable, and the user often names their own session after it too.
- **Otherwise** a terse gist of the task (`add-hammer`, `agenda`).
- **Keep it unique** among concurrent runs — if a bare name could clash (two runs on the same ticket), append two hex characters of your own choosing (no command needed) → e.g. `proj123-3f`.

No `ft-`/`forge-` prefix — nothing keys on it. Keep it ≤ 16 chars (a longer name overflows the unix-socket path; preflight validates and tells you to shorten). The driver references the browser by this name; phase 5 closes it.

**`HEADED`** — drives run **headless** by default; the user watches via the Playwright dashboard (preflight opens it), which renders headless sessions live without a window stealing focus or trapping their typing. Set `HEADED: true` only when:

- `COLLABORATIVENESS` is `step-by-step` (teach — the user physically walks the flow through the browser), **or**
- the user's framing asks to see it ("watch", "headed", "let me take the wheel", "I'll drive").

(The `FORGE_HEADED=1` env setting also selects headed — preflight checks it itself, so don't probe for it. A `forge.md` headed preference is handled after preflight — see 1.2.)

### 1.2. Run preflight (one command)

```bash
node <PLUGIN_ROOT>/scripts/forge-cli.mjs preflight --session <SESSION_NAME>   # add --headed when HEADED is true
```

One call does the whole deterministic setup: locates the forge root, opens the browser session (headless unless headed; you own its lifecycle — preflight opens here, you close in Phase 5), opens the dashboard when headless (idempotent — never steals focus if already up), computes the cleanup-staleness nudge, and prints the files you need in context.

Read its output top to bottom:

- **The JSON summary** — capture `forgeRoot` as `FORGE_ROOT`, `startedAt` as `RUN_STARTED_AT` (the curator's spawn prompt threads it into trace reads so a previous drive's transcript can't shadow this one's), and `cleanupNudge` as `CLEANUP_NUDGE` (hold silently for Phase 5.5a; `cleanupDays` gives the N for its phrasing). `setupSection`/`teardownSection` flag whether forge.md carries those sections for 1.3 and 5.4. `insideTmux` + `teammateMode` feed the banner's teammate-visibility line (3.1) — under `teammateMode: auto`, per-agent panes appear only when the session runs inside tmux; otherwise teammates render inline and the dashboard stays the watch surface.
- **`hints/forge.md`** — the shared operate contract: persona/account resolution, the optional setup/teardown sections, plus the app's selectors and gotchas (which you'll want when routing a driver check-in). The driver reads `forge.md` too; the curator reads its own `curator.md`. All hints are optional — a bare `/forge init` scaffold drives correctly; hints encode project-specific knowledge the teammates can't derive from the app.
- **`protocols/escalation.md`** — you route the driver's check-ins per its **Lead side** (§3); the driver `cat`s the same file on friction, so the shapes stay a single source of truth.
- **`protocols/collaborativeness.md`** — you read the **deference** column to know how readily to involve the user at this run's `COLLABORATIVENESS` level, and you hold/step that level through the run.

Failure modes: exit 1 → no forge root; relay verbatim and stop — the user needs `/forge init`. Exit 2 → session name too long; shorten and retry. Exit 3 → the browser open failed; surface the passed-through error.

**One post-read correction:** if `forge.md` declares a headed preference (e.g. "run headed by default") and this run opened headless with no stronger signal, flip it — `node <PLUGIN_ROOT>/scripts/forge-cli.mjs pw -s=<SESSION_NAME> close`, then re-run preflight with `--headed`.

### 1.3. Apply setup instructions (optional)

If `forge.md` has a `## Setup before each run` section (the JSON's `setupSection: true`), follow it literally (SQL seeding, account-reset endpoint, mint a test user, "don't reset anything"). If absent, skip. If setup captures values (minted credentials), hold them and pass to the driver via the spawn prompt or the env contract in `forge.md`. If setup fails, surface to the user and stop.

## Phase 2 — Create the tasks

The team auto-forms when the first teammate spawns. Skip straight to task creation.

```
TaskCreate(
  subject="forge driver: <USER_TASK>",
  description="Drive the user's browser task end-to-end via playwright-cli session <SESSION_NAME>, scanning <FORGE_ROOT>/snippets/ and invoking matching snippets; signal each meaningful chunk to curator. MODE=<MODE>: in spec mode, after the curator sends snippets-ready, compose a self-contained .spec.ts in <FORGE_ROOT>/specs/ from the drive's own verbatim trace, run it cold via forge-run-spec.mjs, and self-fix (routing snippet-level fixes to the curator). Claim with TaskUpdate(status='in_progress') at start; keep in_progress through the whole run; TaskUpdate(status='completed') at the final report."
)
# Note as DRIVER_TASK_ID.

TaskCreate(
  subject="forge curator: <USER_TASK>",
  description="Watch the driver's action-stream (its transcript) and curate <FORGE_ROOT>/snippets/ in real time — author/patch/split from the driver's VERBATIM trace, triggered by its chunk signals. On drive-complete, finish + send snippets-ready. Stay alive through the driver's spec-verify loop to handle patch-requests. Claim with TaskUpdate(status='in_progress') at start; keep in_progress until the driver's run resolves; TaskUpdate(status='completed') at your completion ping."
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
  subagent_type="forge:driver",
  name="driver",
  prompt="MODE: <MODE>
COLLABORATIVENESS: <COLLABORATIVENESS>
HEADED: <HEADED>
SESSION_NAME: <SESSION_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
CURATOR_NAME: curator
USER_TASK: <user's task verbatim>
<if MODE == spec, include:> SPEC_INTENT: <regression | repro | scenario>  (for repro: the bug claim to assert as correct behavior)

Your task ID is <DRIVER_TASK_ID>. Claim it with TaskUpdate(taskId=<DRIVER_TASK_ID>, status='in_progress'), read your hints, and begin — your browser session <SESSION_NAME> is already open, so drive it directly (only reopen it yourself to recover from a crash). Signal each meaningful chunk to curator. When the run is finished, TaskUpdate(status='completed') and ping team-lead."
)
```

The spawn response carries the agent id as `driver@<TEAM_NAME>` (e.g. `session-36180256`). **Capture `<TEAM_NAME>`** — the curator needs it to locate the driver's transcript. Then:

```
Agent(
  description="Forge <MODE> curator: <short USER_TASK>",
  subagent_type="forge:curator",
  name="curator",
  prompt="MODE: <MODE>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
DRIVER_NAME: driver
TEAM_NAME: <TEAM_NAME>
RUN_STARTED_AT: <RUN_STARTED_AT>
USER_TASK: <user's task verbatim>

Your task ID is <CURATOR_TASK_ID>. Claim it with TaskUpdate(taskId=<CURATOR_TASK_ID>, status='in_progress'), read your hints, and wait for the driver's first chunk signal. The driver may begin before you're ready — its transcript is your backstop, so read forward from the start to catch any early chunks."
)
```

`description` is required by the Agent tool — keep it short.

### 3.1. Print the run banner

Immediately after both spawns, tell the user what's running, where to watch, and how to steer — three short lines, before you go quiet to wait:

> Driving **<short USER_TASK>** — <MODE> mode<append ", collaborativeness: <level>" only when above autonomous>.
> Session **`<SESSION_NAME>`**, headless — watch it live in the Playwright dashboard. *(When HEADED: "headed — a browser window will open; that's the drive.")*
> <Teammate visibility, from preflight's `insideTmux` + `teammateMode`: when panes will appear (inside tmux, mode `auto`/`tmux`), "Driver and curator each get a tmux pane."; otherwise "Driver and curator run inline (no separate panes — launch Claude inside tmux to get per-agent panes)."> 
> Steer anytime by typing here — I'll relay to the team. Say "stop" to abort.

At `guided` / `step-by-step`, extend the banner with the teaching controls so the vocabulary is discoverable up front rather than buried in docs:

> We'll go step by step — forge surfaces each step and waits for your word. Useful phrases: correct a step ("use the other button"), hand control over ("take it from here"), drive yourself ("I'll take the wheel" — tell me where you ended up when you hand back), steer the library ("save that as `login-with-sso`", "split that snippet").

The banner is orientation, not a report — keep it to these lines and stop talking until something happens.

## Phase 4 — Wait for both teammates, relay the user

After spawning, the teammates self-coordinate (the chunk/drive-complete/snippets-ready/patch-request signals flow **directly** between them — you don't relay those). You wait for **two** completion pings and stay available to the user.

**What to watch for:**

- **Completion pings** — `driver` pings `team-lead` when its run is done; `curator` pings when the library work (and, in spec mode, the verify-patch window) has resolved. Proceed to phase 5 only after **both**.
- **Messages addressed to you (`team-lead`)**:
  - **check-in** (usually from the driver) — `CHECK-IN` / `STUCK ON:` / `TEMPTED TO:` / optional `HUNCH:`. The driver has hit friction and handed *you* the routing rather than classifying it or reaching outside the browser. **Route it per `escalation.md` §3 (Lead side)**, loaded by preflight (1.2): answer from the code (read-only — `Glob`/`Grep`/`Read`/`Explore`), hand a concrete steer, take it to the user (`AskUserQuestion` → relay), or offer a teach walk-through (→ 4.0a). The message shapes and reply vocabulary live there; the driver is idle until you reply, so route promptly.
  - **`cannot-drive`** from the driver — terminal failure. Surface in the report; proceed to cleanup.
  - **Status / questions** — answer concisely or relay context.
- **The user steers mid-run** — relay it to the **driver**: `SendMessage(to="driver", summary="steer", message="<the user's instruction>")`. Relay promptly so it lands at the driver's next turn boundary. (Library/snippet steers go to `curator` instead.)
- **Idle notifications** — informational; they fire after every turn. Treat the `task <id> complete` pings as authoritative.

> **Note on `TaskList()`:** calling it from the lead does NOT surface team tasks reliably. Treat the completion pings as authoritative; don't gate phase 5 on TaskList.

### 4.0a. Collaborativeness (deference + teaching)

`COLLABORATIVENESS` (one of `autonomous` | `light-touch` | `guided` | `step-by-step`, default `autonomous`; see `collaborativeness.md`, loaded by preflight in 1.2) sets how readily you bring the user in — you read its **deference** column. At `autonomous` you resolve check-ins yourself wherever you can (asking the user only when *you're* stuck — the floor); each rung up routes more to the user; at `step-by-step` the driver surfaces every step and you carry a step-by-step teaching conversation. You **hold the level and step it mid-run** on the user's framing — "walk me through this next bit" → up a rung; "you can take it from here" → back to `autonomous`. A driver check-in (Phase 4) is also a natural cue to *offer* a walk-through and step up on a yes.

When collaborativeness is high you're an **active interlocutor**, not a passive ping-waiter:

- **Surface the driver's check-ins conversationally.** When the driver messages you "about to <step> — anything to flag?", relay it to the user as plain conversation (not `AskUserQuestion` — teaching is free-form). Pass the user's reply back: `SendMessage(to="driver", summary="steer", message="<go-ahead | the gotcha to fold in | the correction>")`.
- **Relay the cadence change when you nudge the dial.** *"walk me through this next bit"* → `SendMessage(to="driver", summary="cadence", message="collaborate from here — surface each step and wait for the user")`; *"you can take it from here"* → `…message="autonomous from here — drive on your own"`. A normal drive can enter teaching this way and leave it just as easily.
- **Takeover.** *"I'll take the wheel"* / *"let me set up some state"* → `SendMessage(to="driver", summary="takeover", message="user is driving the browser directly — go idle until they hand back")`. When the user returns, ask where they ended up if they don't volunteer it, then relay the grounding: `…summary="resume", message="user handed back. Current state: <their grounding, verbatim>. Resume from here."`
- **Relay library steers to the curator.** Naming / boundary / structure direction — *"cap that as `login-with-sso`"*, *"split this one"*, *"make `item` an arg"* — goes to `curator`, not the driver: `SendMessage(to="curator", summary="library steer", message="<the user's direction>")`.

The lifecycle is otherwise unchanged — two teammates, two completion pings, the same Phase 5 shutdown. Collaborativeness is a *disposition* layered on the normal flow, not a separate path.

### 4.1. Idle-notification stall watchdog

A teammate that finished but forgot to ping appears as idle notifications with no completion summary. For each teammate you're still awaiting, keep a counter of consecutive bare idle notifications (a peer-DM summary resets it). At 3, nudge that teammate once:

```
SendMessage(to="<teammate>", summary="status check", message="What's your status — done? If finished, SendMessage team-lead a completion summary so we can shut down.")
```

If it responds with a completion summary, treat it as the missing ping. If 2 more idle notifications arrive with no response, inspect on-disk artifacts (`ls <FORGE_ROOT>/snippets/`, `ls <FORGE_ROOT>/specs/`), surface state to the user, and proceed to Phase 5 — **the chromium close (5.1) runs regardless of the missing ping** (a dangling teammate must never strand the browser). **Bounded waiting:** if 10+ minutes pass without both pings AND no check-in/cannot-drive, surface to the user and proceed to Phase 5 anyway.

## Phase 5 — Shut down and clean up

A run can end several ways — normally both completion pings; also via the stall watchdog (4.1), a `cannot-drive`, or a user abort. **However it ends, you reach this phase, and your first act is to close the browser (5.1)** — you generated `SESSION_NAME` in 1.1 and own it, so you are the guaranteed backstop. The close needs nothing from the teammates, so it goes first and never waits on the shutdown handshake.

In the normal case — once **both** completion pings have arrived:

### 5.1. Close the chromium session (first — gated on nothing)

```bash
node <PLUGIN_ROOT>/scripts/forge-cli.mjs pw -s=<SESSION_NAME> close
```

Do this **immediately, in this turn, before requesting teammate shutdown.** The close doesn't need the teammates' approvals, so it must never wait behind that async round-trip — waiting is exactly what leaves the browser lingering open after the work is visibly done. Route through `forge-pw`, not the bare `playwright-cli` binary (the guard hook blocks the bare binary). Closing by `SESSION_NAME` reliably catches the live browser however the run ended. Best-effort; fall back to killing the process tree if it survives. The driver may have already closed it — a no-op then.

### 5.2. Request shutdown (both teammates)

For each of `driver` and `curator`:

```
SendMessage(to="<teammate>", summary="team work complete; shutdown", message={"type": "shutdown_request", "reason": "team work done"})
```

Wait for each `{"type": "shutdown_response", "approve": true, ...}`. The response includes a `paneId` (e.g. `"%105"`) when the backend is tmux — capture each for pane cleanup. If a teammate rejects, surface the reason. (The browser is already closed by now, so this wait costs nothing user-visible.)

### 5.3. Kill the leftover tmux panes

```bash
tmux kill-pane -t <paneId>
```

Once per teammate, using the `paneId` from each `shutdown_response`. Best-effort; skip if no `paneId`.

### 5.4. Apply teardown instructions (optional)

Execute any `## Teardown after each run` section in `forge.md`. If absent, skip.

### 5.5. Report to the user

Compose a tight summary. Drive-mode shape:

> <driver's final-result one-liner>
>
> Library: curator wrote N new (<names>), patched M (<names>), split K (<names>) — or "no changes — covered by the existing library".
>
> Worth a hint? <if the driver's ping carried a "Hint worth adding" line — one gentle sentence: "the `finish` button needed `dispatchEvent` again — want me to add a note to `forge.md` so future runs handle it from the start?">
> (Include this line **only** if the driver flagged a recurring pattern; otherwise omit it entirely. It's a suggestion, never a blocking question — the run is already wrapped. If the user says yes, `Edit` the one line into `forge.md` then; if they don't, drop it.)
>
> Next: <only when the drive is a flow plausibly worth re-running — one line: "pin it as a verified spec with `/forge spec <the task>`". Omit for one-off lookups, trivial drives, or anything the user clearly won't repeat.>
>
> Browser session closed.

For a **high-collaborativeness / teach** run, lead with the library line — the curated snippets (with the user's taught gotchas baked in) are the headline, not the drive result.

In spec mode, use the extended shape in `team-task-spec.md` Phase 5.5 — it adds the spec + verification line.

If anything didn't go to plan (`cannot-drive`, a spec parked unverified, snippet invocation failed mid-drive, etc.), surface prominently — the user wants the truth.

### 5.5a. Append cleanup nudge (if preflight reported one)

If `CLEANUP_NUDGE` is non-empty, append a one-line tail:
- `hints` — *"Last hint cleanup was N days ago — consider `/forge clean hints`."* ("never" if no staleness file.)
- `snippets` — *"Last snippet cleanup was N days ago — consider `/forge clean snippets`."*
- `both` — *"Hints and snippets haven't been cleaned in over a week — consider `/forge clean`."* (Or *"No record of any forge cleanup — consider `/forge clean` to baseline."*)

Non-blocking, once-per-run. Don't repeat if the user already cleaned this session.

## Hard rules

- **You are an orchestrator and the routing tier — not an actor on the app.** All browser driving, spec writing, and spec running belong to `driver`; all snippet authoring/patching to `curator`. You set up the team, create the tasks, spawn the two teammates, manage lifecycle, AND own the user channel and the driver's **check-ins**: you decide whether a check-in is answered from the code (read-only research — `Glob`/`Grep`/`Read`/`Explore`), with a concrete steer, or by the user (`AskUserQuestion` → SendMessage back); you relay user steering to the relevant teammate. That read-only research is the one thing you reach for beyond orchestration; you still never drive the browser, write snippet or spec files, run specs, or mutate the app or its environment. The browser **open** happens inside preflight (1.2); your only direct `forge-pw` call is the **close** (5.1) — lifecycle, not driving — and only ever through `forge-pw`, never the bare `playwright-cli` binary.
- **The peer signals are direct — don't relay them.** chunk-complete / drive-complete / snippets-ready / patch-request flow between the driver and curator. You only handle messages addressed to `team-lead`.
- **High collaborativeness makes you an active interlocutor.** `COLLABORATIVENESS` sets how readily you involve the user; at `guided`/`step-by-step` you carry the teaching conversation — relay the driver's per-step check-ins as plain conversation, pass guidance back, step the level and relay library steers on request (Phase 4.0a). The lifecycle is unchanged: still two teammates, two pings, the same Phase 5.
- **The verify loop lives inside the driver.** In spec mode the driver runs its spec cold, diagnoses, fixes spec-logic inline, and routes snippet-level fixes to the curator via patch-request. You don't triage or route snippet/spec fixes — but you field the driver's check-ins (route them: a steer, read-only investigation of the code, or take it to the user), and relay user steers.
- **Wait for BOTH pings before shutdown.** The curator stays alive through the driver's verify loop (for patch-requests); it pings complete only after the run resolves. Don't shut anyone down early.
- **Always close the chromium session — first, on every exit path.** Both pings, a watchdog timeout, `cannot-drive`, a rejected shutdown, or a user abort all still reach 5.1, and the close runs before the shutdown handshake (never gated behind it). You own `SESSION_NAME`; a run never ends with the browser left open.
- **`forge.md` is the source of truth for test-account / credential resolution.** Don't invent accounts or hardcode credentials.

## Failure modes to recover from

- **`Agent(...)` fails because agent teams aren't enabled** → surface the Prerequisite remedy and stop.
- **Driver returns `cannot-drive` early** → surface; proceed to cleanup (the curator likely has nothing to author — let it wrap up).
- **A teammate goes idle and never responds** → nudge (4.1); if still silent, surface state and proceed to close the session.
- **Credentials missing** → driver checks in on an empty env key; surface the missing key to the user.
