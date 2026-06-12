---
name: forge-team
description: "Drive browser tasks via the forge agent team — driver runs in a per-slot chromium with per-slot env from the session pool. Walks up from CWD to find the project's forge/ directory, loads hints, claims a pool slot (provisioning one if exhausted via the project's recipe), spawns the driver-team agent, releases on completion. Stage 2: driver-only — author/spec-writer/verifier land in later stages."
model: haiku
effort: medium
argument-hint: "<description of the browser task to perform>"
allowed-tools: Read, Skill, Bash(bash **/forge/*/scripts/*), Bash(node **/forge/*/scripts/*), Bash(direnv:*), Bash(playwright-cli:*), Bash(mkdir:*), Bash(jq:*), Bash(cat:*), Bash(echo:*), Bash(ls:*)
---

# /forge-team

The thin orchestration switchboard for the forge agent-team architecture. You walk up from the user's CWD to find their project's `forge/` directory, load the hint files, manage the session-pool slot lifecycle, spawn the driver agent with everything it needs, and clean up on return.

For **Stage 2** the team has exactly one role: `forge:driver-team`. The author / spec-writer / verifier agents and inter-agent messaging land in subsequent stages — for now, your job is to prove the slot lifecycle and per-slot env injection work end-to-end.

This skill is a **thin orchestrator**. The driver does the actual browser work; you just set up the right context and clean up after.

If the user is asking about something that isn't a browser task, you're in the wrong skill.

## Preamble (every invocation)

### 1. Find the project's forge root

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-find-root.sh
```

Walks up from PWD looking for a `forge/hints/` directory. Prints the absolute path to the project's `forge/` directory, or fails with a helpful error if none found.

If it fails (exit non-zero), relay the error verbatim to the user and stop. They need to run `/forge-init` first.

Capture the path — call it `FORGE_ROOT` for the rest of this skill (overloading the legacy meaning, but in this skill it's the project's forge dir).

### 2. Load the hints

Two files are mandatory for this skill to function:

```bash
cat <FORGE_ROOT>/hints/forge.md
cat <FORGE_ROOT>/hints/driver.md
```

Capture both contents — you'll pass them to the driver agent. If `driver.md` is missing that's fine (driver uses defaults); if `forge.md` is missing, fail with "missing forge/hints/forge.md — required to know how to set up env injection and the pool."

The `forge.md` hint declares:
- **Env contract** — which env keys each slot exports (e.g. `SAUCE_USERNAME`, `SAUCE_PASSWORD`)
- **Env loading approach** — how to wrap commands so the slot's env is loaded (typically `direnv exec <slot-dir>`)
- **Pool location** — defaults to `<FORGE_ROOT>/.pool/`, may be overridden in the hint
- **Provisioning recipe** — step-by-step instructions for minting a new slot when the pool is exhausted

You'll execute the provisioning recipe yourself if the pool is exhausted — read it carefully before claiming.

### 3. Determine the pool location

Default: `<FORGE_ROOT>/.pool/`. If `forge.md` declares an override under "Pool location", honor that instead. Capture as `POOL_DIR`.

### 4. Initialize the pool if it doesn't exist yet

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-init.sh <POOL_DIR>
```

Idempotent — safe to run every time. Creates the pool dir + `.lock` file if missing.

## Claim phase

### 5. Attempt to claim a slot

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-claim.sh <POOL_DIR>
```

Three possible outcomes:

- **Prints a slot path** (exit 0) — claim succeeded. Capture as `SLOT_DIR` and continue to the drive phase.
- **Prints `EXHAUSTED` to stderr** (exit 1) — pool is empty or all slots are taken. Continue to provisioning (step 6).
- **Any other error** (exit ≥2) — surface the error to the user and stop.

### 6. Provision a new slot (only if EXHAUSTED)

Read the **Provisioning recipe** section of `forge.md` (you already loaded it). The recipe is a numbered list of steps you execute in order. Typical steps:

1. Pick an identifier (persona name, generated username, etc.)
2. `mkdir -p <POOL_DIR>/slot-<id>/profile`
3. Write `<POOL_DIR>/slot-<id>/.envrc` with the right exports per the hint's spec
4. Write `<POOL_DIR>/slot-<id>/state.json` with `{ "checkedOutBy": null }`
5. `direnv allow <POOL_DIR>/slot-<id>` (or whatever the project's env loader needs)

Execute each step via Bash. The recipe will be specific to the project; follow it literally.

If the recipe requires picking an identifier from a finite set (e.g. saucedemo's 6 personas), the recipe will tell you how to pick one not already in the pool. Check `ls <POOL_DIR>/slot-*` against the candidate list.

If the recipe genuinely cannot be satisfied (e.g. all candidates already provisioned AND all checked out — pool truly exhausted), surface:

> /forge-team: pool exhausted and provisioning recipe cannot satisfy a new slot (\<specific reason from the recipe\>). Wait for an existing slot to release, or expand the project's available identity space.

After successfully provisioning, re-attempt the claim (step 5). It should now succeed.

## Drive phase

### 7. Determine the playwright-cli session name

The slot's `state.json` may already have a `playwrightSessionName` field if a previous claim launched chromium. If so, reuse it (warm chromium). If not, compute a new short name and persist it:

```bash
# Read existing if present
SESSION_NAME=$(jq -r '.playwrightSessionName // empty' <SLOT_DIR>/state.json)

# If empty, generate one and persist
if [ -z "$SESSION_NAME" ]; then
  # Short name: 'ft-' + 8 hex chars of a md5 hash of the slot dir.
  # macOS caps unix socket paths so session names must stay short (~14 chars).
  SESSION_NAME="ft-$(printf '%s' "<SLOT_DIR>" | md5 -q | cut -c1-8)"
  TMP=$(mktemp)
  jq --arg n "$SESSION_NAME" '.playwrightSessionName = $n' <SLOT_DIR>/state.json > "$TMP" && mv "$TMP" <SLOT_DIR>/state.json
fi
```

(On Linux, replace `md5 -q` with `md5sum | cut -d' ' -f1`.)

### 8. Spawn the driver-team agent

The agent prompt is structured — leading context lines, then the user's task verbatim:

```
Agent(subagent_type="forge:driver-team",
  prompt="FORGE_SLOT: <SLOT_DIR>
SESSION_NAME: <SESSION_NAME>
PROJECT_HINT_FORGE:
<contents of forge.md, indented or fenced — pass as-is>

PROJECT_HINT_DRIVER:
<contents of driver.md, indented or fenced — pass as-is, or empty if missing>

Your task: <original user request verbatim>")
```

Wait for the driver to return.

The driver returns one of three formats (first line determines):

- `Drove: <summary>` followed by `Steps:` `Result:` and optionally `Note:` — success, continue to release.
- `no-session: <reason>` — driver couldn't establish a playwright-cli session. Surface to user; release the slot (the chromium may be in a weird state, the next claimant will relaunch).
- `cannot-drive: <reason>` — driver bailed. Surface to user; release the slot.

## Release phase

### 9. Release the slot

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-pool-release.sh <POOL_DIR> <SLOT_DIR>
```

Runs the slot's optional `release.sh` hook (if present) then clears `checkedOutBy`. If the hook fails, the release script will tell you — surface that to the user as part of your final message but don't fail the whole drive (the drive itself succeeded).

### 10. Report to the user

Surface the driver's `Drove:` block verbatim. Add a short context line about the slot if useful:

> Drove via `slot-standard_user`.
>
> Drove: logged in as standard_user, navigated to inventory.
> Steps: launch session → login → goto inventory
> Result: on /inventory.html, six product cards visible

If the driver returned `no-session` or `cannot-drive`, surface that verbatim and note the slot was released.

## Hard rules

- **You are an orchestrator, not an actor.** All browser driving belongs to `forge:driver-team`. Your direct actions are: discovery, hint loading, pool setup/claim/release, agent invocation. You do NOT invoke `playwright-cli` yourself.
- **Surface driver output verbatim.** Don't paraphrase the `Drove:` block; the user wants to see what the agent reported.
- **Always release.** Even if the driver returned `cannot-drive` or `no-session`, release the slot back to the pool. The next claimant relaunches chromium if needed; leaving a slot perpetually checked out wastes capacity.
- **Provisioning recipe is the source of truth for slot creation.** Don't invent fields, don't skip steps, don't add extras. Execute literally.

## What this skill does NOT do (yet)

These land in later stages — explicitly out of scope for Stage 2:

- **No snippet authoring.** The `forge:author-team` agent + its prompt arrive in Stage 3. For now, the driver's bash tool calls are the only record; nothing accretes to `forge/snippets/`.
- **No spec writing.** Stage 4.
- **No verifier.** Stage 4.
- **No user escalation channel for stuck-driver scenarios.** Stage 5. If the driver gets stuck in Stage 2, it returns `cannot-drive` and the user re-invokes with refined instructions.
- **No parallel-runs handling beyond what the pool already provides.** Stage 6 stress-tests concurrent invocations.

That's deliberate — keep Stage 2 minimal so the foundation (discovery + pool + slot env + single agent spawn) gets validated cleanly before more moving parts arrive.
