# Forge

A browser-automation team for Claude Code. Forge spawns a small mesh of agents that drive a real browser, capture reusable snippets, and (on request) compose verified Playwright specs from the work.

The default mode just does the thing you asked for. Spec mode is opt-in for when a flow is worth pinning into CI.

## Requirements

- **Node.js** — any recent version (tested on 24).
- **playwright-cli** — `brew install playwright-cli`. Forge wraps it.

Supported on macOS, Linux, and Windows. Forge's scripts are pure Node; cross-platform locking, JSON state, and hashing are handled internally — no `bash`, `jq`, `flock`, or `md5sum` required on the host.

## Quick start

1. **Install the plugin** (one time per machine):

   ```bash
   claude plugin marketplace add vivecuervo7/forge
   claude plugin install forge@vive-forge
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

On first spec run (or first snippet invocation), forge lazy-installs its Playwright runner directly into the project's `forge/` directory (standard `package.json` + `node_modules/` layout). Self-contained per project, visible in the IDE, removed cleanly by `rm -rf forge/` if you ever want to uninstall.

## Commands

| Command | What it does |
|---|---|
| `/forge init` | Scaffolds the `forge/` directory convention into the current project. Idempotent. The starting point for any new project. |
| `/forge <task>` | **Drive mode.** Driver + snippet-author. Does the task end-to-end, accretes reusable snippets from novel work. The everyday command. |
| `/forge spec <task>` | **Spec mode.** Adds spec-writer + spec-verifier. Composes a self-contained `.spec.ts` and confirms it passes from a cold start. |
| `/forge teach <topic>` | **Teach mode.** Driver + snippet-author. User pilots forge turn-by-turn, signals snippet boundaries explicitly, and weaves project-specific gotchas (fallbacks, retries, conditional branches) into snippet bodies. The deliberate library-building channel — useful when the app has quirks the agent can't be expected to discover. |
| `/forge run <spec\|last\|latest>` | Re-runs a verified spec via the standalone runner. Add `record as <label>` to capture a video at `forge/videos/<spec>-<label>.webm`. No team spawned. |
| `/forge export <spec-name>` | Exports a composed spec to a self-contained inlined form, suitable for shipping into another test suite. |

Spec mode also fires on natural-language signals — "create a spec for AE-1775", "write a spec that…", "capture as a spec". Teach mode fires on phrasings like "teach forge how to log in" or "let me show forge how to create an event." Plain `/forge <task>` is the unambiguous drive case.

Recording is on demand: `/forge run last spec, record as before` → fix the bug → `/forge run last spec, record as after` → attach both videos to the PR. The same spec produces paired evidence.

## Three pillars: drive, teach, spec

Each mode does a different job. Pick by what you want out of the session.

**Drive (`/forge <task>`)** — fastest path. Forge does the task; the snippet-author accretes any novel work into the library opportunistically. Best when you want the action performed and any library growth is a side benefit.

**Teach (`/forge teach <topic>`)** — deliberate library building. You pilot forge step-by-step through the conversation, signal snippet boundaries explicitly, and bake gotchas (auto-login fallback, stuck-loader retry, dispatchEvent quirks) into the snippet bodies. Best when the app has quirks the agent can't be expected to discover on its own — login flows, conditional UIs, anything where "the obvious approach doesn't work."

**Spec (`/forge spec <task>`)** — pin a verified flow. Forge drives, writes a self-contained `.spec.ts`, and confirms it passes from cold. Best when the flow is worth a CI test artifact and paired before/after evidence (via `/forge run`).

Teach-mode mechanics in brief:

- The user is the snippet curator. The driver doesn't autonomously plan — it executes one user-translated action at a time.
- **Instructions and snippets are orthogonal.** A user instruction is one browser action; a snippet may span many instructions (or just one, or none). The user walks forge through the work, then caps a snippet when they reach a meaningful boundary — usually after several steps. Most instructions won't be cap-points.
- The user can take over the browser mid-session for state setup ("I'll create the test event myself"); user-driven actions are not recorded. A bearing-grounding statement ("I'm now on /event/123") gets the agent re-oriented before the next directed step.
- Snippet boundaries are user-signalled: "cap that as `login`" / "save the last four steps as `create-event`." If the name already exists, the user gets an explicit replace-or-rename choice — overwrite protection is user-driven here, not author-driven.
- Annotations the user volunteers (or that fall out of the conversation) get woven into the snippet body, not just the description. This is the load-bearing knowledge — the bit the driver would have missed.

## See it in action

Try a sample before adopting forge for your own project. Each sample is a project-shaped directory — committed hints, scaffolded config, real-forge-output seed snippets — plus a prompt-by-prompt walkthrough you run yourself.

| Sample | What you'll see |
|---|---|
| [`samples/shop/`](./samples/shop) | Authentication, multi-account hint pattern, full spec-mode pipeline with verifier iteration, and **two browsers running in parallel under different accounts** |
| [`samples/internet/`](./samples/internet) | Variant-arg parameterisation — one snippet covers a family of probe pages |
| [`samples/widgets/`](./samples/widgets) | Compositional decomposition — fill + read snippets compose into larger flows |

**Start with shop** if your work involves any authenticated app — that walkthrough exercises the most surface area. Each sample's README has the exact commands; budget 5–15 minutes per walkthrough.

## Why forge vs …

Three honest comparisons against the closest alternatives. Each tool is right when its trade-offs match what you need.

### vs Playwright codegen

Codegen is a recorder. Click through a flow in a browser, it emits a single `.spec.ts` of the equivalent code. One-shot output — no library, no persisted project knowledge, no awareness across recordings.

Forge is the durable version of that workflow. The same drive that completes the task also accretes reusable snippets into a library that future drives invoke instead of re-recording the same interactions. Hints capture project-specific selectors and gotchas, so the next person doesn't re-learn them. Spec mode produces a verified `.spec.ts` composed from the library — so the spec stays compact and survives selector drift in any one snippet.

Pick codegen when you need a one-off recording you'll commit and rarely touch. Pick forge when the flows you're testing will be re-driven, evolved, or composed into larger scenarios.

### vs playwright-cli (the bare CLI)

`playwright-cli` is the tool forge wraps. It's a command interface: `open`, `click`, `fill`, `run-code`. Stateless per command. No agents, no library, no hint convention.

Forge layers the agent team, the snippet library, the hint files, and the spec pipeline on top of it. If you're scripting one-off browser interactions and don't need anything to persist between commands, the bare CLI is the right tool. If you want a library that accretes, hint-driven authoring, or verified spec output — that's the work forge does on top.

### vs hand-writing Playwright tests

Hand-writing is the maximum-control option. You read the docs, inspect the DOM, choose selectors, structure tests as you see fit. Quality depends on your discipline and how much project knowledge you've internalised.

Forge takes the "what selector should I use", "what's the right decomposition", "what gotcha did I forget" questions and automates the discovery — combining hints (project knowledge you write once) with agents that drive the real app and verify what they produced. The output is plain Playwright code you'd be happy to write by hand: just authored faster, with selectors verified against the live app, and against a library that grows from real driving.

Pick hand-writing when you have unusual structural requirements (custom fixtures, non-Playwright tooling integration, deeply unusual assertions) that don't fit forge's standard shape. Pick forge when you want the standard shape and would rather have the library accrete from real use than build it up by hand.

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
    Verifier -.->|"failures"| Driver
    Verifier -.->|"failures"| Writer

    Driver -->|"drive / invoke"| Chrome
    Author -->|writes| Snippets
    Writer -.->|writes| Specs
    Verifier -.->|runs| Specs
```

| Agent | Role |
|---|---|
| `forge:driver` | Drives the browser via `playwright-cli` against a fresh chromium session. Invokes existing snippets where they match; drives fresh otherwise. |
| `forge:snippet-author` | Listens to driver narration during the drive. Writes per-step snippets for novel work into `forge/snippets/`. |
| `forge:spec-writer` *(spec mode)* | Composes a self-contained `.spec.ts` after the drive completes. Imports snippets for invoked steps; inlines code for fresh-drive steps. |
| `forge:spec-verifier` *(spec mode)* | Runs the spec via `forge-run-spec.mjs` against a fresh browser context, surfaces pass/fail. Iterates with driver / spec-writer on failure. |

Dashed edges fire only in spec mode. Drive mode runs the top two agents (driver + snippet-author) and stops once the task is done; spec mode adds the bottom two for spec composition + verification. Teach mode also runs just driver + snippet-author, but the lead's role is much more active — it pipes user input to the driver turn-by-turn and only writes snippets when the user explicitly caps them.

## Session model

Each `/forge` invocation is stateless. Launch a fresh chromium with an ephemeral profile, run the user's task, close the chromium at the end. Clean state every time, by design.

Multi-account scenarios are project-owned. If your project has multiple test accounts, document them in `forge/hints/forge.md` in whatever shape fits — an account list, a role table, a SQL minting recipe, a vault-lookup script. The driver reads the hint and follows it.

For parallel runs against the same project, the constraint is whatever your backend imposes (single-session-per-user is common). Document the constraint in `forge.md`; the user respects it when launching parallel sessions.

## Hints

`forge-init` scaffolds `forge/hints/` with one file per consumer. Hints are natural-language instructions to the agents, not config.

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

Hints don't need to be complete at start. While working, each agent can surface **proposals** — patterns it noticed during a run that would belong in a hint file. The team-lead relays these to you at the end of a session: a short observation, evidence (which snippet, which selector, what behaviour was non-obvious), and a suggested edit. You accept, modify, or reject.

This means a useful hint set can accrete from real driving rather than being front-loaded. Start with the env contract in `forge.md` and the canonical selectors in `driver.md`; the rest grows as the agents surface what they actually find useful. See [`samples/shop/forge/hints/snippet-author.md`](./samples/shop/forge/hints/snippet-author.md) for a worked example — that file was proposed by `forge:snippet-author` during a real drive, not hand-authored, after it noticed a recurring precondition pattern across two snippets.

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

Each session launches its own ephemeral chromium profile, so browser-side state stays clean without configuration. `## Setup before each run` is for state forge can't reach on its own — server-side data, account provisioning, anything outside the browser. `## Teardown after each run` is the symmetric hook for end-of-run cleanup (server-side state, logout endpoints).

## Storage layout

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

Only `hints/` is tracked. Everything else is local per-machine. `forge-init` regenerates the rest from convention. See the scaffold's inline comments for adapting to projects with their own Playwright runner.

## Environment variables

Env handling is delegated to your project. Whatever's in `process.env` at run time is what your specs and snippets see — direnv, dotenv-cli, manual shell exports, a secrets manager, or the optional dotenv line in the scaffolded `forge/playwright.config.ts` all work; pick what fits your setup.

The driver follows one rule: **env values are referenced, never inlined**. It uses native shell expansion (`$ADMIN_USERNAME`) inside its Bash commands; the shell expands at exec time; the tool-call transcript records the unexpanded reference. The rule applies uniformly to every env var — predictable hygiene over per-call judgment.

For projects with multiple test accounts, document the mapping in `forge/hints/forge.md` in whatever shape fits — a naming convention (admin → `$ADMIN_USERNAME` / `$ADMIN_PASSWORD`, user → `$USER_USERNAME` / `$USER_PASSWORD`), a provisioning recipe, or anything else. The driver reads the hint and follows it.

## License

MIT
