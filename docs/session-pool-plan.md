# Session pool — design and implementation plan

Status: **planned, sandbox-first approach.** Captured 2026-06-12.

Add a generic file-based session pool to the forge plugin. Fixes parallel-run contention, the chromium process leak, and per-run env injection in one abstraction. Work happens in a dedicated sandbox repo (`~/repos/forge-tests`) before any plugin code is touched; backport to `plugins/forge/` once conventions stabilize.

## Scope

**In scope:**
- Base `/forge` skill — discover and load project hints, claim pool slots, invoke project-supplied wrapper scripts
- `~/repos/forge-tests` — sandbox repo for iterating on conventions, validated against saucedemo as the demo target
- Pool primitive scripts (init/claim/release) — built and iterated in the sandbox, backported once stable

**Out of scope (deliberately):**
- Any changes to makerx-ea, `/forge-browse`, or EA-specific hints. EA is reference-only — its parallel-run pain motivated this work, but the implementation will validate against saucedemo and only later be considered for EA adoption.
- Migration logic. Nothing is deployed beyond the author of the plugin today; backport is a clean break with no compat layer.
- Watch loop + hint injection — see `project-forge-watch-loop` memory; complementary work, can land alongside or after.
- Snippet name collision namespacing — orthogonal concern; defer until it becomes a real problem.

## Background

The current per-Claude-session run model (`scripts/forge-session.sh`) gives each Claude Code session its own `runs/<session-id>/profile/` chromium profile. This works for single drives but breaks down for parallel work:

1. **Login thrash.** Multiple concurrent forge drives against the same web app share `process.env.PORTAL_USERNAME`-style env vars. Apps that allow only one active session per user bump each driver to `/login` repeatedly. Observed 2026-06-11 with two parallel runs against EA's planner-app.
2. **Chromium process leak.** Completed forge runs don't kill their chromium. After ~5 runs the host has 50+ orphaned processes and ~840MB of leftover profile dirs.
3. **Project-specific knobs need somewhere to live.** Today each project authors a wrapper skill (`makerx-ea:forge-browse`, etc.) to encode its forge integration. Adding forge to a new project requires writing a skill, which is high friction.

The session pool design unifies the fix for all three by making each forge run claim a slot from a file-based pool, with per-slot env loaded from project-supplied wrapper scripts that the project's hint file describes.

## Design

### What forge owns

- **Pool directory convention.** Each slot is a directory with `state.json` (claim state) + `profile/` (chromium profile). Pool root has `.lock` for atomic claims.
- **Claim/release/exhaust lifecycle** via `flock`.
- **Base `/forge` skill** that walks up from CWD looking for a `forge/` directory (same pattern as git), reads `forge/hints/`, and orchestrates accordingly.
- **Driver discipline rule:** never interpolate env values into emitted code; always reference via `process.env.X` at runtime. The session transcript is durable; baked values would leak.
- *Nothing about env file formats.* Forge never reads `.env`, `.envrc`, or anything similar — that's the project's wrapper script's job.

### What projects own (via hint files — no wrapper skill required)

- **Env contract.** Which env keys each slot needs (e.g. `SAUCE_USERNAME`, `SAUCE_PASSWORD`).
- **Slot env files.** The provisioning recipe writes whatever format the project chose (`.env`, `.envrc`, sops-encrypted, etc.). Forge doesn't peek.
- **Wrapper script.** Translates "slot dir + command" into "command run with the slot's env loaded." Hint points at its path. For direnv users: `direnv exec <slot-dir> <command>`. For plain-dotenv: source-and-exec. For sops: decrypt-and-exec.
- **Provisioning recipe** in the hint: how to mint a new slot when the pool is exhausted.
- **Optional release cleanup** beyond the default cookie/localStorage wipe.

### No wrapper skill required

Previously, project integrations meant authoring a wrapper skill (e.g. `makerx-ea:forge-browse`) that knew the project's forge root, env setup, and runner config. With hints absorbing all that context, the base `/forge` skill can do it directly. New projects scaffold `forge/` (via `/forge init`), author a hint file, and `/forge` works.

Wrapper skills are still useful when a project needs **multi-tool orchestration beyond forge** (e.g. EA's `/ae-investigate` does Jira + GitHub lookups before driving). But for pure forge use, hints are sufficient.

## Project layout convention

```
<project-root>/
└── forge/
    ├── .gitignore        # ignore everything except hints/
    ├── README.md         # what this dir is
    ├── hints/            # COMMITTED: project hint files
    ├── snippets/         # local: working snippets, auto-authored + curated
    ├── specs/            # local: spec-writer output, copy to tests/ when ready
    └── videos/           # local: screen recordings
```

The `forge/.gitignore` is self-documenting:

```
# By default, everything in this directory is local to your machine.
# Snippets, specs pending review, and videos are working artifacts you
# build up as you use forge — not things every teammate needs in the repo.
#
# Hints are the exception: they describe project-specific knowledge that
# every contributor needs (env contract, provisioning recipes, etc.).
#
# If your project has additional artifacts that should be shared (e.g.
# specific snippets you've curated and want everyone to use), add a
# `!path/` line below.

*
!.gitignore
!README.md
!hints/
!hints/**
```

Project-root `.gitignore` says nothing about forge — the `forge/.gitignore` handles it internally.

Runtime state (session transcripts, pool slots, chromium profiles) lives **outside** the project at XDG paths:
- `~/.local/share/forge-pool/` — pool slots
- `~/.local/state/forge/sessions/` — session jsonl transcripts

Nothing leak-prone touches the project tree.

## Example: saucedemo hint file

```markdown
# Saucedemo forge-pool hint

## Slot env contract
Each slot must export:
- SAUCE_USERNAME  — one of saucedemo's documented test personas
- SAUCE_PASSWORD  — always "secret_sauce"

## Slot-write format
.envrc using direnv. Cascade from a parent .envrc via source_up if present.

## Wrapper script
forge/scripts/forge-pool-exec.sh — direnv-exec wrapper.

## Pool provisioning recipe
Saucedemo's persona set is fixed at 6 entries. To add a slot:

1. Pick a persona not already represented. Available:
   - standard_user             (happy path)
   - locked_out_user           (login fails on purpose)
   - problem_user              (visual + interaction bugs)
   - performance_glitch_user   (artificial latency)
   - error_user                (checkout fails)
   - visual_user               (visual glitches)
2. mkdir -p <pool>/slot-<persona>/profile
3. Write <pool>/slot-<persona>/.envrc:
     source_up
     export SAUCE_USERNAME=<persona>
     export SAUCE_PASSWORD=secret_sauce
4. Write <pool>/slot-<persona>/state.json: { "checkedOutBy": null }
5. direnv allow <pool>/slot-<persona>
6. Re-attempt claim.

If all 6 personas are pooled and all checked out, the pool is genuinely
exhausted. Wait for one to release.

## Release cleanup
Clear cookies and localStorage on returned profile.
```

## Implementation phases

### Sandbox stage (in `~/repos/forge-tests`)

**Phase 1 — scaffold the sandbox repo.**
Create `~/repos/forge-tests/` with the project layout convention. Initial contents:
- `forge/.gitignore` (self-documenting policy)
- `forge/README.md`
- `forge/hints/forge-pool.md` (the saucedemo hint above)
- `forge/scripts/forge-pool-exec.sh` (`exec direnv exec "$slot_dir" "$@"`)
- Top-level `README.md`, `package.json`, `playwright.config.ts`

**Phase 2 — build pool primitives as standalone scripts in forge-tests.**
- `forge-pool-init.sh <pool-dir>` — `mkdir -p`, `chmod 700`, create `.lock`
- `forge-pool-claim.sh <pool-dir>` — atomic flock, scan slot dirs for `checkedOutBy: null`, claim and print slot path, or print `EXHAUSTED`
- `forge-pool-release.sh <pool-dir> <slot-dir>` — flock, release, invoke project release hook if present

These iterate freely in forge-tests. No plugin code changes yet.

**Phase 3 — drive saucedemo manually with the new structure.**
Use the existing `/forge` (or directly-invoked playwright-cli) to drive saucedemo against the pool. Validate end-to-end: parallel runs claim different slots, env injection produces different logged-in personas, snippets accrete to `forge/snippets/`, specs land in `forge/specs/`.

**Phase 4 — iterate the conventions until they feel right.**
Blow away `~/repos/forge-tests/forge/` and `~/.local/share/forge-pool/saucedemo/`, rebuild from learnings. Repeat. The sandbox is meant to be rebuilt many times until the conventions stop revealing issues.

### Backport stage (to `plugins/forge/`)

**Phase 5 — move stabilized scripts into the plugin.**
Pool primitives move to `plugins/forge/scripts/`. Drop the local copies in forge-tests; the sandbox now uses the plugin's versions.

**Phase 6 — update base `/forge` skill.**
Make it walk up from CWD looking for `forge/`, load `forge/hints/`, claim a pool slot, invoke the project's wrapper script with `FORGE_SLOT=<slot-dir>`. Replace any session-scoped-run logic with hint-driven pool-scoped behavior.

**Phase 7 — add driver discipline rule.**
Edit `plugins/forge/agents/driver.md` to include: never interpolate env values into emitted code; always reference via `process.env.X`.

**Phase 8 — plugin internal layout restructure.**
Update the plugin's own working directory layout to match the convention (`forge/` with the four-dir shape). Clean break — no migration code since nothing is deployed beyond the author.

## What this fixes

- **Parallel-run login thrash** — each pool slot has its own env via the wrapper script.
- **Chromium process leak** — pool size caps the total chromium count; release leaves chromium warm, not killed.
- **Disk accumulation** — slots cycle through claim/release rather than accreting per-run.
- **High friction for new project adoption** — `/forge init` + a hint file replaces "author a wrapper skill."
- **Env / credential injection** — clean indirection via project-supplied wrapper; project chooses dev-literals or secret-manager.

## Validation criteria

Sandbox stage is correct if:
- A single `/forge "drive standard_user through checkout"` from `~/repos/forge-tests/`: hits empty pool, runs the provisioning recipe, provisions slot-standard_user, claims it, drives the flow, releases it. Spec lands in `forge/specs/`. Snippets land in `forge/snippets/`.
- Two parallel `/forge` invocations against different personas: get different slots, log in as different users, complete cleanly without thrash.
- A third `/forge` invocation against an already-pooled persona: reuses the existing slot, no provisioning.
- The `forge/.gitignore` correctly excludes everything except `hints/` from version control; `git status` after a run shows no new files outside `forge/hints/`.

Backport stage is correct if:
- The base `/forge` skill works against `~/repos/forge-tests/` without any forge-tests-specific scripts (the wrapper script is forge-tests's, but the skill, pool primitives, and driver agent are all from the plugin).
- The plugin's own working directory uses the new convention; old paths (`library/`, `staged/`, `runs/`, etc.) are gone.

## References

- `project-forge-session-pool` memory — same design captured for personal-memory recall
- `project-forge-watch-loop` memory — complementary feature (visibility + steering)
- `project-forge-parallel-credentials` memory — historical context: original discovery of EA's single-session-per-user constraint
