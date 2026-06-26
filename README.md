# Forge

A browser-automation team for Claude Code. Forge spawns a small mesh of agents that drive a real browser, capture reusable snippets, and (on request) compose verified Playwright specs from the work.

The default mode just does the thing you asked for. Spec mode is opt-in for when a flow is worth pinning into CI. If the team gets genuinely stuck, it escalates back to you with what it tried and what blocked it rather than spinning.

## Requirements

- **Node.js** — any recent version (tested on 24).
- **playwright-cli** — `brew install playwright-cli`. Forge wraps it.

Supported on macOS, Linux, and Windows.

## Quick start

1. **Install the plugin** (one time per machine):

   ```bash
   claude plugin marketplace add vivecuervo7/forge
   claude plugin install forge@vivecuervo7
   ```

2. **Enable experimental agent teams** in `~/.claude/settings.json`, then restart Claude Code:

   ```json
   { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
   ```

3. **Scaffold your project** from inside it:

   ```
   /forge init
   ```

   This creates `forge/` with a `hints/` directory, a fallback Playwright config, and a self-documenting `.gitignore`.

4. **Drive a task.** For an unauthenticated site, the bare scaffold is enough:

   ```
   /forge <describe what you want done>
   ```

   That launches a fresh chromium and goes. For sites with auth or other project-specific behaviour, author hint files in `forge/hints/` (see `forge/hints/README.md` for guidance). All five hints are optional and additive: write only what you need.

   **Want to see forge run end-to-end before adopting it?** [Try the samples](./samples) — three project-shaped directories with hints already authored and prompt-by-prompt walkthroughs against public test sites. 5–15 minutes per walkthrough.

## Commands

### Core workflow

| Command | What it does |
|---|---|
| `/forge init` | Scaffolds the `forge/` directory convention into the current project. Idempotent — the starting point for any new project. |
| `/forge <task>` | **Drive mode.** Driver + snippet-author. Does the task end-to-end, accretes reusable snippets from novel work. The everyday command. |
| `/forge spec <task>` | **Spec mode.** Adds spec-writer + spec-verifier. Composes a self-contained `.spec.ts` and verifies it from a cold start against its declared **intent** — a *regression* test (assert correct behavior, expect green), a *red-green bug repro* (assert correct behavior, expect **red** until the bug is fixed), or an assertion-less *scenario* (re-run via `/forge run`). Also fires on natural-language signals — "create a spec for PROJ-123", "write a failing spec that reproduces…", "capture as a spec". |

### Spec intents: one artifact, per-assertion expected outcomes

A forge spec is a re-runnable flow whose assertions each carry an expected outcome; it *verifies* when the run matches that expectation. The intent is mandatory and explicit (the lead asks if the task is ambiguous), so the verifier never has to guess whether a red is success or a defect:

- **regression** — all hard `expect(...)`, expected green. The default.
- **repro** — the bug claim is `expect.soft(...)` asserting the **correct** behavior, so the spec is honestly **red** against the buggy build (the failure *is* the reproduction) and goes **green** once the fix lands. Setup assertions stay hard/green. The verifier treats *red at the bug claim* as success; a green run signals the bug appears fixed → promote the soft claim to a hard regression assertion. Same artifact, red→green across the fix — no annotations, no `test.fail()`, portable through `npx playwright test` and `/forge export`.
- **scenario** — no assertions; success = a clean run.

### Teach mode

| Command | What it does |
|---|---|
| `/forge teach <topic>` | A **collaborative drive**: forge drives a step at a time while you walk it through the quirky bits, and the gotchas you teach (fallbacks, retries, conditional branches) get baked into snippet bodies. Same `driver-worker` + `snippet-curator` as a normal drive, in collaborative posture — and you can slip into it mid-run ("let me walk you through this next bit") and back out ("you can take it from here"). The deliberate library-building channel for quirks the agent can't be expected to discover. Also fires on "teach forge how to …" / "let me show forge how to …" phrasings. |

### Re-running and shipping

| Command | What it does |
|---|---|
| `/forge run <spec\|last\|latest>` | Re-runs a verified spec via the standalone runner. No team spawned. |
| `/forge export <spec-name>` | Exports a composed spec to a self-contained inlined form, suitable for shipping into another test suite. |

Add `record as <label>` to a run invocation to capture a video at `forge/videos/<spec>-<label>.webm`. `/forge run last spec, record as before` → fix the bug → `/forge run last spec, record as after` produces paired evidence for a PR.

### Maintenance

| Command | What it does |
|---|---|
| `/forge clean [snippets\|hints\|both]` | Periodic sweep over `forge/snippets/` and `forge/hints/`. Regenerates `snippets/INDEX.md`, surfaces snippet overlaps, hint sections that should be snippets or scripts, Jira-keyed snippet names, and stale meta. Findings surface via `AskUserQuestion` — nothing is applied without your approval. |

## See it in action

Try a sample before adopting forge for your own project. Each sample is a project-shaped directory — committed hints, scaffolded config, real-forge-output seed snippets — plus a prompt-by-prompt walkthrough you run yourself.

| Sample | What you'll see |
|---|---|
| [`samples/shop/`](./samples/shop) | Authentication, multi-account hint pattern, full spec-mode pipeline with the lead-orchestrated verify loop, and **two browsers running in parallel under different accounts** |
| [`samples/internet/`](./samples/internet) | Variant-arg parameterisation — one snippet covers a family of probe pages |
| [`samples/widgets/`](./samples/widgets) | Compositional decomposition — fill + read snippets compose into larger flows |

**Start with shop** if your work involves any authenticated app — that walkthrough exercises the most surface area. Each sample's README has the exact commands; budget 5–15 minutes per walkthrough.

## Why not codegen, playwright-cli, or hand-writing?

- **Codegen** records one flow into one `.spec.ts`. Forge accretes snippets across drives and bakes project knowledge into reusable hints.
- **playwright-cli** is the stateless command interface forge wraps. Forge adds the agent team, snippet library, hints, and spec pipeline on top.
- **Hand-writing** is the maximum-control option. Forge trades some control for automated selector / decomposition / gotcha work, with cold-start verification on the output.

## Maintenance

Forge accretes — snippets, hints, proposals — and that accretion needs a light periodic sweep to stay clean. Two mechanisms keep the library healthy without manual policing:

- **Proposal-review lint.** When sub-agents emit end-of-session hint proposals, the lead lints them before relaying. Code-shaped proposals (TypeScript / Playwright snippets disguised as hint prose) and cross-file duplicates are caught before they bloat `forge/hints/`. Hint files stay lean by construction.
- **`/forge clean`.** The periodic sweep — run it weekly or whenever a session feels like it accreted noise. The cleanup-scan script surfaces snippet overlaps, hint sections that should be snippets or scripts, Jira-keyed snippet names (which date fast), and stale meta. Each finding surfaces via `AskUserQuestion`; nothing is applied without your approval. `/forge clean snippets` also regenerates `forge/snippets/INDEX.md`.
- **Phase 0 staleness nudge.** After any `/forge` run, if the last `/forge clean` was more than 7 days ago, the lead adds a one-line tail nudge to its summary. Non-blocking — you can ignore it and keep working.

Sub-agent discipline supports the lint from the authoring side. Driver, snippet-author, and spec-writer each scan `forge/snippets/INDEX.md` before authoring to avoid overlap, and decline to emit code-shaped proposals when they could write a snippet or script instead. When a spec fails verification, the team fixes the snippet or spec body that caused it — diagnosed from a live cold re-drive — rather than patching around it. Details live in [`agents/driver.md`](./agents/driver.md), [`agents/snippet-author.md`](./agents/snippet-author.md), and [`agents/spec-verifier.md`](./agents/spec-verifier.md).

## Snippet library

Every snippet in `forge/snippets/` carries a structured `meta` block at the top of the file:

| Field | Required | Purpose |
|---|---|---|
| `description` | yes | One-line summary — what the snippet does. |
| `args` | yes | Args object; `{}` if the snippet takes none. |
| `tags` | optional | Free-form tags for grouping (e.g. `['auth']`, `['checkout', 'angular']`). |
| `flow` | optional | Name of a multi-step flow the snippet belongs to (e.g. `shop-checkout`). |
| `phase` | optional | Phase within that flow (e.g. `billing→payment`). |
| `requires` | optional | Page / state the snippet expects before invocation. |
| `enters` | optional | Page / state the snippet leaves the browser in. |
| `composes` | optional | Names of other snippets this one shells out to. |
| `supersedes` | optional | Names of older snippets this one replaces. |

`forge/snippets/INDEX.md` is the auto-generated contract — a grouped table read by the lead at session start so it knows the library shape without reading every snippet body. It regenerates whenever a snippet is added or modified, and whenever `/forge clean snippets` runs. Treat it as derived; edit the `meta` blocks, not the file.

## Structured JSON output

The `forge-pw` wrapper around `playwright-cli` accepts `--json` (or `FORGE_JSON=1`) and emits a single JSON envelope: `{ ok, result, error }`. This is mostly for advanced users and the driver agent's internal calls — everyday driving works the same as before. Reach for it when scripting forge into a larger pipeline or when you want machine-parseable failure modes.

## Architecture

Four agents communicate in a mesh via `SendMessage`. The `/forge` skill is the **team lead** — it spawns teammates, manages the lifecycle (session start, team creation, shutdown), and bridges the user channel for STUCK escalations.

```mermaid
flowchart LR
    User([User])
    Lead[/"/forge skill<br/>(team lead)"/]
    Driver(["forge:driver"])
    Author(["forge:snippet-author"])
    Writer(["forge:spec-writer<br/><i>spec mode only</i>"])
    Verifier(["forge:spec-verifier<br/><i>spec mode only</i>"])
    Chrome[("chromium<br/>+ playwright-cli")]
    Snippets[("forge/snippets/")]
    Specs[("forge/specs/")]

    User <-->|"STUCK / report"| Lead
    Lead -->|spawn| Driver
    Lead -->|spawn| Author
    Lead -.->|spawn| Writer
    Lead -.->|spawn| Verifier

    Driver <-->|"narrate steps"| Author
    Driver -.->|"final-state"| Writer
    Writer -.->|"spec ready"| Verifier
    Verifier -.->|"pass / fail artifact"| Lead
    Lead -.->|"diagnose (cold re-drive)"| Driver
    Lead -.->|"fix directive"| Writer
    Lead -.->|"fix directive"| Author
    Lead -.->|"re-run"| Verifier

    Driver -->|"drive / invoke"| Chrome
    Author -->|writes| Snippets
    Writer -.->|writes| Specs
    Verifier -.->|runs| Specs
```

| Agent | Model | Role |
|---|---|---|
| `forge:driver` | sonnet | Drives the browser via `playwright-cli` against a fresh chromium session. Invokes existing snippets where they match; drives fresh otherwise. |
| `forge:snippet-author` | sonnet | Listens to driver narration during the drive. Writes per-step snippets for novel work into `forge/snippets/`. |
| `forge:spec-writer` *(spec mode)* | sonnet | Composes a self-contained `.spec.ts` after the drive completes. Imports snippets for invoked steps; inlines code for fresh-drive steps. |
| `forge:spec-verifier` *(spec mode)* | sonnet | A thin gate: runs the spec via `forge-run-spec.mjs` against a fresh browser context and reports a distilled pass/fail artifact to the lead. It doesn't debug — on failure the lead orchestrates the fix loop. |

Dashed edges fire only in spec mode. Drive mode runs the top two agents (driver + snippet-author) and stops once the task is done; spec mode adds the bottom two for spec composition + verification. On a spec failure the **lead is the hub**: the verifier reports the failure, the lead triages it by failure-class — routing app-behavior failures to the driver for a *cold re-drive* (driving the failing slice fresh to observe the real cause, rather than trusting the warm drive's memory) and spec-logic / assertion failures to the spec-writer — then routes the resulting fix to spec-writer / snippet-author and tells the verifier to re-run. The lead owns the convergence judgment and is the only agent that escalates to the user. Teach mode also runs just driver + snippet-author, but the lead's role is much more active — it pipes user input to the driver turn-by-turn, and snippet-author only writes when the user explicitly caps a snippet.

**Token usage:** every agent and the `/forge` skill itself declare `model: sonnet` in their frontmatter — no Opus tokens are spent on forge work.

## Session model

Each `/forge` invocation is stateless. Launch a fresh chromium with an ephemeral profile, run the user's task, close the chromium at the end. Clean state every time, by design.

For parallel runs against the same project, the constraint is whatever your backend imposes (single-session-per-user is common). Document the constraint in `forge.md`; the user respects it when launching parallel sessions.

## Hints

`/forge init` scaffolds `forge/hints/` with one file per consumer. Hints are natural-language instructions to the agents, not config.

| File | Read by |
|---|---|
| `forge.md` | The skill + driver (env contract, app-level setup, teardown, any project-specific account/role conventions) |
| `driver.md` | `forge:driver` (app structure, selector inventory, gotchas) |
| `snippet-author.md` | `forge:snippet-author` (project-specific snippet conventions) |
| `spec-writer.md` | `forge:spec-writer` (spec naming, imports) |
| `spec-verifier.md` | `forge:spec-verifier` (verification conventions) |

**All hints are optional.** Forge drives correctly against the bare scaffold — the defaults cover unauthenticated sites with no special setup. Author hint files only to encode project-specific knowledge the agents can't discover on their own:

- **`forge.md`** — usually the first one worth writing if your site has auth, a custom provisioning recipe, or pre-/post-run state needs.
- **`driver.md`** — worth writing once you've watched a few drives and noticed the driver enumerating selectors the docs could've handed it.
- **The other three** — write only if the project-default behaviour collides with what you want.

### Hints grow during use

Hints don't need to be complete at start. Each agent surfaces **proposals** at the end of a session — patterns it noticed during the run that belong in a hint file. The lead relays them with an observation, evidence, and a suggested edit; you accept, modify, or reject. Start with the env contract in `forge.md` and canonical selectors in `driver.md`; the rest accretes from real driving. See [`samples/shop/forge/hints/snippet-author.md`](./samples/shop/forge/hints/snippet-author.md) for a worked example — proposed by `forge:snippet-author` during a real drive, not hand-authored.

### Setup / teardown

`forge.md`'s optional `## Setup before each run` section is for state forge can't reach on its own — server-side data, account provisioning, "wipe the events table" SQL, anything outside the browser. `## Teardown after each run` is the symmetric hook for end-of-run cleanup. The lead executes whatever the hint says in plain prose; there's no DSL.

## Project scaffolding

```
<project>/forge/
├── hints/                  # committed — your project's knowledge
│   ├── forge.md
│   ├── driver.md
│   ├── snippet-author.md
│   ├── spec-writer.md
│   └── spec-verifier.md
├── snippets/               # gitignored — accreted via snippet-author
├── specs/                  # gitignored — composed during spec mode
├── videos/                 # gitignored — recordings from /forge run
├── node_modules/           # gitignored — lazy-installed runner deps
├── package.json            # gitignored — forge-managed runner manifest
├── playwright.config.ts    # gitignored — scaffolded fallback runner config
├── .gitignore              # gitignored — self-ignores; only hints/ tracked
└── README.md               # gitignored — scaffold, explains the layout
```

Only `hints/` is tracked. Everything else is local per-machine. `/forge init` regenerates the rest from convention. See the scaffold's inline comments for adapting to projects with their own Playwright runner.

On first spec run (or first snippet invocation), forge lazy-installs its Playwright runner directly into the project's `forge/` directory (standard `package.json` + `node_modules/` layout). Self-contained per project, visible in the IDE, removed cleanly by `rm -rf forge/` if you ever want to uninstall.

## Environment variables

Env handling is delegated to your project. Whatever's in `process.env` at run time is what your specs and snippets see — direnv, dotenv-cli, manual shell exports, a secrets manager, or the optional dotenv line in the scaffolded `forge/playwright.config.ts` all work; pick what fits your setup.

**Document the loading recipe in `forge/hints/forge.md`.** Don't assume the driver's shell will pick up your `.envrc` or `.env` on its own — tell it explicitly how to load values. The driver prepends whatever recipe you put in `forge.md` to commands that need env values. See [`samples/shop/forge/hints/forge.md`](./samples/shop/forge/hints/forge.md) for a worked example using `set -a && source .env && set +a`.

The driver follows one rule: **env values are referenced, never inlined**. It uses native shell expansion (`$ADMIN_USERNAME`) inside its Bash commands; the shell expands at exec time; the tool-call transcript records the unexpanded reference. The rule applies uniformly to every env var — predictable hygiene over per-call judgment.

For projects with multiple test accounts, document the mapping in `forge.md` in whatever shape fits — a naming convention (admin → `$ADMIN_USERNAME` / `$ADMIN_PASSWORD`, user → `$USER_USERNAME` / `$USER_PASSWORD`), a provisioning recipe, or anything else. The driver reads the hint and follows it.

