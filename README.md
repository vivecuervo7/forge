# forge

A browser-automation team for Claude Code. Forge spawns a small mesh of agents that drive a real browser, capture reusable snippets, and (on request) compose verified Playwright specs from the work.

The default mode just does the thing you asked for. Spec mode is opt-in for when a flow is worth pinning into CI.

## Install

```bash
claude plugin marketplace add vivecuervo7/claude-plugins
claude plugin install forge@vive-claude
```

Forge depends on Claude Code's **experimental agent teams** primitive. Enable it once:

```bash
# in ~/.claude/settings.json
"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }
```

Then restart Claude Code.

Once a project is forge-init'd (below), the plugin lazy-installs its Playwright runner under `~/.claude/.vive-claude/forge/runner/` on first spec run.

## Requirements

- **playwright-cli** — `brew install playwright-cli`. Forge wraps it.
- **macOS or Linux**. Lock file primitives use `flock` (Linux) or `lockf` (macOS).
- **Node.js** — any recent version (tested on 24).
- **jq** — used by the pool scripts for state.json edits.

## Commands

| Command | What it does |
|---|---|
| `/forge <task>` | **Drive mode.** Driver + snippet-author. Does the task end-to-end, accretes reusable snippets from novel work. Fastest path. |
| `/forge spec <task>` | **Spec mode.** Adds spec-writer + spec-verifier. Composes a self-contained `.spec.ts`, runs it from a cold start, records video. |
| `/forge-init` | Scaffolds the `forge/` directory convention into the current project. Idempotent. |
| `/forge-export <spec-name>` | Exports a composed spec to a self-contained inlined form, suitable for shipping into another test suite. |

Spec mode also fires on natural-language signals — "create a spec for AE-1775", "write a spec that…", "capture as a spec". Plain `/forge <task>` is the unambiguous drive case.

Add `record as <label>` to spec mode and the verifier's video lands at `forge/videos/<spec-basename>-<label>.webm`. Without a label, the suffix is a timestamp. Re-running with the same label overwrites — useful for before/after comparisons against the same spec.

## Architecture

Four agents communicate in a mesh via `SendMessage`. The skill spawns them, manages the team lifecycle, and surfaces user-channel events (STUCK escalations, completion pings).

| Agent | Role |
|---|---|
| `forge:driver` | Drives the browser via `playwright-cli` against a claimed slot. Invokes existing snippets where they match. |
| `forge:snippet-author` | Listens to driver narration during the drive. Writes per-step snippets for novel work into `forge/snippets/`. |
| `forge:spec-writer` *(spec mode)* | Composes a self-contained `.spec.ts` after the drive completes. Imports snippets for invoked steps; inlines code for fresh-drive steps. |
| `forge:spec-verifier` *(spec mode)* | Runs the spec via `forge-pool-run-spec.mjs` against the still-warm slot, records video, surfaces pass/fail. Iterates with driver/spec-writer on failure. |

## Pool + slot model

Forge owns a per-project pool of chromium "slots." Each slot is persona-bound (e.g. `slot-standard_user`, `slot-problem_user`) with its own profile dir and `.env` for credentials. Claims are serialized by a file lock; two concurrent `/forge` invocations grab different slots and run in parallel.

At claim time, the lead invokes a filesystem-level scrub of cookies + localStorage + sessionStorage on the slot's profile — covers the universally-biting class without depending on the previous chromium session being alive. Project-specific cleanup (database resets, account churn, third-party state) is hint-driven (see below).

## Hints

`forge-init` scaffolds `forge/hints/` with one file per consumer. Hints are natural-language instructions to the agents, not config.

| File | Read by |
|---|---|
| `forge.md` | The skill (env contract, provisioning recipe, setup, teardown) |
| `driver.md` | `forge:driver` (app structure, gotchas) |
| `snippet-author.md` | `forge:snippet-author` (project-specific snippet conventions) |
| `spec-writer.md` | `forge:spec-writer` (spec naming, imports) |
| `spec-verifier.md` | `forge:spec-verifier` (verification conventions) |

All are optional. The minimum to be operational is `forge.md` with an env contract + provisioning recipe.

### Setup / teardown

`forge.md`'s `## Setup before each run` section drives the lead's pre-drive work. Examples:

```markdown
## Setup before each run

Create a fresh test user:

\`\`\`sql
INSERT INTO users (email, role)
VALUES ('test-' || gen_random_uuid() || '@example.com', 'standard')
\`\`\`

Capture the generated email; the spec needs it as the login identity.
```

Or simply:

```markdown
## Setup before each run

Don't reset any state — runs share state intentionally.
```

The default scrub fires unless the hint says not to. `## Teardown after each run` is the symmetric escape hatch for end-of-run cleanup forge can't infer (server-side state, logout endpoints).

## Storage layout

```
<project>/forge/
├── hints/                  # committed
│   ├── forge.md
│   ├── driver.md
│   ├── snippet-author.md
│   ├── spec-writer.md
│   └── spec-verifier.md
├── .pool/                  # gitignored — slot state
│   ├── slot-<persona>/
│   │   ├── .env           # per-persona credentials
│   │   ├── profile/       # chromium profile
│   │   └── state.json     # { checkedOutBy, lastClaimed, lastReleased }
│   └── ...
├── snippets/               # gitignored by default — accreted via author
├── specs/                  # gitignored — composed during spec mode
├── videos/                 # gitignored — verifier recordings
├── .env                    # gitignored — forge-specific env
├── playwright.config.ts    # scaffold — fallback if no project runner
└── .gitignore              # self-ignores; only hints/ tracked by default
```

Only `hints/` is tracked. Everything else is local per-machine. `forge-init` regenerates the rest from convention. See the scaffold's inline comments for adapting to projects with their own Playwright runner.

## Credentials

Forge speaks dotenv natively. Three layers, last-set wins:

1. **`<project-root>/.env`** — baseline.
2. **`forge/.env`** — forge-specific overrides.
3. **`<slot>/.env`** — per-persona overrides (injected by `--slot` on wrapper scripts).

User shell env (e.g. `direnv` with 1Password injecting `OP_TOKEN`) sits on top — already in `process.env` when the wrappers start; wins via `dotenv`'s non-override default. Direnv is your personal layer, not forge's mechanism.

## Use cases

- **Routine drudgery.** "Delete all emails from `noreply@noisy-vendor.com`."
- **PR / GitHub flows.** "Paste the GIF at `~/Desktop/demo.gif` into PR #42's description."
- **Multi-step forms.** JIRA submissions, expense reports, deploy approval pages.
- **Triage + verification.** "Open the dashboard, check the error count, screenshot anything > 50."
- **Bug repro + verification specs.** `/forge spec AE-1775 record as before` then again with `record as after` to produce a paired before/after recording bound to the spec.

## License

MIT
