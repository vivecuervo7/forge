# /forge — teach reference

This reference is loaded by `/forge`'s router for the **teach** route. The router has stripped the `teach` keyword from the args; what remains (if anything) is the user's framing intent for the session ("teach login", "show forge how to create an event"). The intent is just session framing — the real work happens turn-by-turn between you (the lead) and the user.

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below is a placeholder — substitute the literal path the router captured in SKILL.md phase 1.0. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in the bash context that runs from this reference.

## What this route does

Spawns driver + snippet-author against a slot. No spec-writer, no spec-verifier. You (the lead) run an interactive loop with the user: the user describes what they want forge to do or capture; you translate to the driver; the driver narrates back to the author; the author waits for your explicit "cap this as `<name>`" signals before writing snippets.

The output is curated snippets — entered into the library with the user's gotcha annotations baked into the bodies. There is no spec artifact.

## Why teach mode exists

In drive mode the driver discovers project quirks by trial and error — and that knowledge dies with the session unless it happens to land in a snippet. Hint files are wrong for the same knowledge: login-flow quirks placed in `driver.md` get loaded for every agent on every run, even when login isn't relevant.

Teach mode is the **snippet-internal deposit channel.** The user already knows the quirks; teach mode is the structured way to encode them into snippet bodies where they belong — invoked when relevant, invisible otherwise.

## Prerequisite

Agent teams are gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. If `TeamCreate` isn't available in this session, surface to the user with the remedy:

> /forge requires experimental agent teams. Enable by adding `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` to `~/.claude/settings.json` (or set the env var in your shell) and restart Claude Code.

Then stop.

## Phase 1 — Discovery and setup

Identical to team-task's phase 1 — find forge root, load hints, initialize pool, claim slot, apply setup, compute session name. The default scrub still applies unless `forge.md` opts out. Capture `FORGE_ROOT`, `POOL_DIR`, `SLOT_DIR`, `SESSION_NAME`.

Teach mode uses `forge.md`, `driver.md`, and `snippet-author.md` only — `spec-writer.md` and `spec-verifier.md` are unused.

See `team-task.md` phases 1.1 through 1.6 for the exact steps; they are byte-for-byte identical here.

## Phase 2 — Create the team

### 2.1 Generate a team name

```bash
RUN_ID="${SESSION_NAME#ft-}-$(date +%s | tail -c 5)"
TEAM_NAME="forge-${RUN_ID}"
```

### 2.2 TeamCreate

```
TeamCreate(team_name="<TEAM_NAME>", description="Forge teach session: <user's intent or 'interactive snippet authoring'>")
```

### 2.3 Create the tasks (two only)

```
TaskCreate(
  subject="drive: teach mode — execute lead instructions step by step",
  description="In teach mode you do NOT autonomously decompose the task. Wait for the lead's per-step SendMessage instructions; execute one at a time; narrate each to snippet-author. The lead drives a turn-based conversation with the user and translates user intent into your instructions. Stay alive until the lead sends shutdown_request."
)
# → DRIVE_TASK_ID

TaskCreate(
  subject="snippet-author: teach mode — author on explicit cap signals",
  description="In teach mode, wait for the lead's 'cap as <name>' SendMessage rather than inferring boundaries. The lead will tell you the name, the steps to include, and any annotations (gotchas, retry logic) to weave into the snippet body. Accept lead-passed edit consent for existing-snippet overwrites."
)
# → AUTHOR_TASK_ID
```

## Phase 3 — Spawn the teammates

### 3.1 Spawn the driver

```
Agent(
  description="Drive teach session",
  subagent_type="forge:driver",
  team_name="<TEAM_NAME>",
  name="driver",
  prompt="TEAM_NAME: <TEAM_NAME>
MODE: teach
SPEC_WRITER_PRESENT: no
FORGE_SLOT: <SLOT_DIR>
SESSION_NAME: <SESSION_NAME>
PROJECT_FORGE_ROOT: <FORGE_ROOT>
PROJECT_HINT_FORGE:
<forge.md contents>

PROJECT_HINT_DRIVER:
<driver.md contents, or 'none' if missing>

USER_TASK: <user's framing intent verbatim, e.g. 'teach login flow'>

Your task ID is <DRIVE_TASK_ID>. Claim it via TaskUpdate(owner='driver', status='in_progress'). In teach mode you do NOT plan or autonomously drive — wait for the lead's per-step SendMessage instructions and execute them one at a time. Each instruction is one of:

- [act] <single user-translated action> — execute it; narrate to snippet-author as usual.
- [ground] <scene-setting from a user takeover> — informational only; don't execute. Update your mental model of current state.
- [pause] — user is taking over the browser. Stop acting until you receive a [resume] message; respond with an idle acknowledgement.
- [resume] <state from the user> — user is back. Acknowledge; wait for the next [act].

Don't message spec-writer (there isn't one). Stay alive until the lead sends shutdown_request."
)
```

### 3.2 Spawn the snippet-author

```
Agent(
  description="Author snippets (teach)",
  subagent_type="forge:snippet-author",
  team_name="<TEAM_NAME>",
  name="snippet-author",
  prompt="TEAM_NAME: <TEAM_NAME>
MODE: teach
PROJECT_FORGE_ROOT: <FORGE_ROOT>
SPEC_WRITER_PRESENT: no
USER_TASK: <user's framing intent verbatim>
PROJECT_HINT_SNIPPET_AUTHOR:
<snippet-author.md contents, or 'none' if missing>

Your task ID is <AUTHOR_TASK_ID>. Claim it via TaskUpdate(owner='snippet-author', status='in_progress'). In teach mode, do NOT infer snippet boundaries from driver narration. Wait for the lead's explicit 'cap as <name>' SendMessage. The lead's cap message contains the snippet name, the steps to include, and any annotations (gotchas, fallbacks, retry logic) drawn from the user. Weave annotations into the snippet body — they are the load-bearing knowledge the user is teaching, not decoration for the description.

For each cap signal, follow the plan-before-write protocol: resolve STEPS, draft a plan (structure + args + hardcoded values), and either fast-path (trivial caps only — single concern, no args, no hardcoded values) or SendMessage the lead a plan and wait for the user's resolution before writing. Your agent prompt covers the full protocol in the 'Teach mode' section.

If the cap message includes EDIT_EXISTING=yes, the user has authorized an in-place overwrite — skip the usual overwrite check and edit the file. Otherwise apply standard overwrite check (Read existing, decide skip / patch / rename)."
)
```

## Phase 4 — The teach loop

You (the lead) are the user's interlocutor. Unlike drive/spec modes where you wait passively for completion pings, in teach mode you actively shepherd the conversation. Each loop iteration is one of these.

**Two channels, not one.** Instructions drive the browser; cap signals build the library. They are orthogonal:

- An `[act]` instruction is one browser action — it always produces driver narration but does **not** by itself produce a snippet.
- A cap signal references a *range* of past narrated steps — usually multiple `[act]`s — and produces a snippet.

The user may walk through many `[act]`s with no cap (exploring, setting context). They may then cap a multi-step snippet covering the last several `[act]`s. They may also cap something narrower than the last instruction (e.g. "cap just the auto-login-check part of those last two steps"). Treat boundaries as fluid and user-driven.

### 4.1 User describes the next instruction

Examples: "go to /login", "click the menu button", "search for 'hammer'", "click the first product card." Translate to a single-step `[act]` SendMessage to driver:

```
SendMessage(
  to="driver",
  summary="next: <one-line>",
  message="[act] <user's instruction, lightly normalized into actionable form>"
)
```

Wait for the driver to acknowledge completion (it will narrate to snippet-author, which surfaces in your conversation as an idle notification with the peer-DM summary). Then wait for the user's next signal — that signal might be another `[act]`, a takeover, a cap, or the end of the session. **Don't prompt them for a cap after every action.** Most `[act]`s won't be cap-points; only some will. The user decides.

If the driver hits a snag, surface it to the user verbatim — they're piloting and need to decide how to recover.

### 4.2 User signals takeover

Examples: "I'll handle this bit", "let me set up some state", "I'm going to do the next part manually." Tell the driver:

```
SendMessage(
  to="driver",
  summary="user takeover",
  message="[pause] User is taking over the browser. Do not act until you receive a [resume] message. The chromium window is the user's during this interval."
)
```

The driver acknowledges and goes idle. You then wait for the user to come back.

When the user resumes, they should provide a **bearing-grounding statement** — where they ended up, anything that changed about the page state. If they don't volunteer one, ask: "Where did you end up? I need to tell the driver the current state."

Then:

```
SendMessage(
  to="driver",
  summary="resume — user on <where>",
  message="[resume]
[ground] User completed takeover. Current state: <user's grounding statement, verbatim>.

Wait for the next [act] instruction."
)
```

**User-driven actions during takeover are never recorded.** Anything the user wants captured as a snippet, they need to walk the driver through via `[act]` instructions after resumption.

### 4.3 User signals a snippet boundary

Examples: "cap that as `login`", "make this a snippet called `add-product-to-cart`", "save the last three steps as `create-event`", "save the last five steps but not the search step as `create-event`." This is the load-bearing operation in teach mode.

Cap signals can fire at any time and reference any range of past narrated steps — the last action, the last few, a contiguous chunk further back, or even a non-contiguous selection. Don't assume "cap" means "the most recent step"; if there's ambiguity about which steps the user means, ask before sending the cap to the author.

#### 4.3.1 Check for collision

```bash
ls <FORGE_ROOT>/snippets/<name>.ts 2>/dev/null
```

If a snippet with that name exists, ask the user via `AskUserQuestion`:

```
AskUserQuestion(
  questions: [{
    question: "A snippet `<name>` already exists. Replace it with the new teaching, or pick a different name?",
    header: "Snippet collision",
    options: [
      { label: "Replace it", description: "Author will edit in place — your teaching supersedes the existing snippet" },
      { label: "Pick a new name", description: "Keep both — you'll specify a new name" },
    ],
    multiSelect: false,
  }]
)
```

On replace → `EDIT_EXISTING = yes`. On rename → capture the new name and re-check for collision.

#### 4.3.2 Probe sparingly for annotations

Only when there's something worth resolving. Examples of when to ask:

- **Multiple selectors worked during the steps** — "The driver had multiple selectors that matched (`<A>`, `<B>`). Was there one you'd prefer the snippet to use? (If unsure, the driver picked `<X>`.)"
- **Something failed and was recovered from** — "We recovered from `<Y>` mid-flow. Should the snippet include that recovery (e.g. retry-on-stuck), or treat it as a one-off?"
- **An action behaved differently than the obvious primitive suggested** — "The driver used `dispatchEvent('click')` because `.click()` didn't fire. Worth noting in the snippet body, or just let it be?"

Skip probing if none of these apply. Don't run a checklist. Trust user-volunteered annotations; only ask when context surfaced an ambiguity worth resolving.

#### 4.3.3 Send the cap signal

```
SendMessage(
  to="snippet-author",
  summary="cap as <name>",
  message="CAP AS: <name>
EDIT_EXISTING: <yes|no>

STEPS: <list the driver-narrated steps that should be included — by ordinal ('the last three driver steps') or by description ('the login fill + submit + auto-login-detection branch')>

ANNOTATIONS:
- <annotation 1 — e.g. 'if loader persists >10s, reload page and retry'>
- <annotation 2 — e.g. 'auto-login may fire on landing; check for /dashboard URL before filling form'>
(or 'none' if the user volunteered no annotations and your probing surfaced none)

Weave annotations into the snippet body as code (waits, conditional branches, retry loops), not just into the description."
)
```

#### 4.3.4 Receive the author's plan (if non-trivial)

The author drafts a plan and decides whether to surface it. For trivial caps (single concern, no args, no hardcoded values worth flagging) the author writes directly and jumps to 4.3.5. For everything else, the author SendMessages you with `summary: "plan ready: <name>"` and a body describing structure (with alternatives if decomposable), args (with the user-typed values they derived from), hardcoded values (with reasons), and annotations.

Surface the plan to the user via `AskUserQuestion`. The exact options depend on what the author proposed:

**When the plan includes a structural alternative (multi-element-class case):**

```
AskUserQuestion(
  questions: [{
    question: "Plan for `<name>`:
- Args: { <list from plan> }
- Hardcoded: <list, or 'none'>
- Alternative: split into `<X>` + `<Y>`

How do you want to proceed?",
    header: "Plan review",
    options: [
      { label: "Proceed as planned",
        description: "One snippet, args + hardcoded as listed" },
      { label: "Split into <X> + <Y>",
        description: "Two snippets — <Y> would also reuse against <author's stated rationale>" },
      { label: "Keep as one, adjust args",
        description: "I'll specify which hardcoded values should be args instead" },
    ],
    multiSelect: false,
  }]
)
```

**When the plan has no structural alternative (single-concern case with args/hardcoded worth reviewing):**

```
AskUserQuestion(
  questions: [{
    question: "Plan for `<name>`:
- Args: { <list from plan> }
- Hardcoded: <list, or 'none'>

How do you want to proceed?",
    header: "Plan review",
    options: [
      { label: "Proceed as planned",
        description: "Write as proposed" },
      { label: "Adjust args",
        description: "I'll specify which hardcoded values should become args, or which args should be hardcoded" },
    ],
    multiSelect: false,
  }]
)
```

`AskUserQuestion` always also exposes an "Other" path for free-form answers — the user can use that for any structural or arg revision the listed options don't cover.

Capture the user's choice and SendMessage the author back:

```
SendMessage(
  to="snippet-author",
  summary="plan_resolved",
  message="plan_resolved — choice: <one of: 'proceed as planned' | 'adjust args' | 'split into <X> + <Y>' | 'other'>
<if 'adjust args': specifics — e.g. 'add capacity to args; remove tier'>
<if 'split': proceed with the named split>
<if 'other': verbatim user direction>"
)
```

The author writes per the resolution.

#### 4.3.5 Author confirms; report to user

The author writes (or edits) the snippet and pings you when done — one ping per file in the split case. Report back to the user: *"wrote `<name>.ts`"* or *"updated `<name>.ts` in place"* or *"split: wrote `<X>.ts` and `<Y>.ts`."*

### 4.4 User ends the session

Examples: "that's enough", "we're done", "wrap up", "ship it." Stop the loop and proceed to phase 5.

If the user has driven actions in the current chunk but not yet capped them, ask once: *"You drove steps `<short list>` but didn't cap them. Want to save them as a snippet, or discard?"* — then proceed based on their answer.

### 4.5 Driver STUCK during a teach step

Same protocol as team-task — driver SendMessages `team-lead` with STUCK, you surface via `AskUserQuestion`, you SendMessage the answer back. The user is already in the loop, so the STUCK is just a slight pause in normal flow rather than a special escalation.

## Phase 5 — Shut down and clean up

Same as team-task phase 5:

1. `SendMessage(to="driver", ..., message={"type": "shutdown_request", "reason": "teach session complete"})`
2. `SendMessage(to="snippet-author", ..., shutdown_request)`
3. Wait for both `shutdown_response`s; capture `paneId`s.
4. `TeamDelete()`
5. `tmux kill-pane -t <paneId>` for each captured pane (best-effort).
6. Apply `## Teardown after each run` instructions from `forge.md` if present.
7. `bash <PLUGIN_ROOT>/scripts/forge-pool-release.sh <POOL_DIR> <SLOT_DIR>`

### 5.4 Report to the user

```
> Teach session complete via `slot-<persona>`.
>
> Authored / updated N snippet(s):
>   - <name1> — <one-line; flag new vs edited>
>   - <name2> — ...
> (or "No snippets captured — session was exploratory.")
>
> Slot released. Team cleaned up.
```

## Hard rules

- **You are the user's interlocutor.** Unlike drive/spec modes where you wait for completion pings, in teach mode you actively shepherd the conversation. User input arrives as new turns; translate each into the appropriate `[act]` / `[pause]` / `[resume]` / cap message.
- **One driver action per `[act]` instruction.** Don't batch user requests into a multi-step prompt. The teach value is the user's per-step supervision.
- **User actions during takeover are not recorded.** Only steps you forward via `[act]` become candidates for snippet inclusion. Takeover is for state setup, not stealth capture.
- **Snippet boundaries are user-driven, but informed by the author.** Author only writes on explicit cap signals from you, but caps go through a plan-review step where the author surfaces structure / args / hardcoded values before writing. The user remains the final authority; the author retains judgment that surfaces as a proposal, not a unilateral decision.
- **Edit consent flows through you.** When the user says "replace `<name>`", you set `EDIT_EXISTING=yes` in the cap message. The author's usual overwrite protection is deliberately suppressed here — the user has already opted in.
- **No spec artifact.** Teach mode produces snippets, not specs. If the user wants a spec from the resulting library, that's a follow-up `/forge spec <task>`.

## Failure modes to recover from

- **Driver returns `cannot-drive` mid-loop.** Surface to user; ask whether to retry the last `[act]`, take over manually, or wrap up. The session can continue — teach mode is more forgiving than drive mode because the user is already steering.
- **Author rejects a cap signal** (e.g. ambiguous step reference, name collision they couldn't resolve). Surface their question to the user and relay the answer back.
- **User goes quiet for a long stretch.** Idle wait is fine — there's no completion ping to chase. The driver and author can sit idle indefinitely. Resume on the next user message.
