# forge

A browser assistant for repeatable user actions.

`forge` lets Claude drive a browser to do repeatable user actions — fill the form you fill every week, paste a GIF into a PR description, navigate a five-step UI you'd rather not click through again. The first time Claude does it, forge captures the path as a small `.ts` snippet. Next time you ask, it's already in the library; cheap invocation rather than fresh investigation.

Each Claude session gets its own managed Chrome by default, with an isolated profile under `$FORGE_ROOT/runs/<session-id>/`. Two concurrent Claude sessions (e.g. across worktrees) run independent browsers — no shared tabs, no clobbering. If you'd rather Claude drive your everyday browser session, opt in to attach mode via `FORGE_CDP_PORT` (see [Browser model](#browser-model)).

Specs are downstream and optional — if a flow becomes worth pinning into CI, `/forge spec` synthesises a runnable `.spec.ts` from the recorded drive.

## Install

```bash
claude plugin marketplace add vivecuervo7/claude-plugins
claude plugin install forge@vive-claude
```

First use bootstraps a data root under `~/.claude/.vive-claude/forge/`. The bootstrap is idempotent.

## Requirements

- **playwright-cli** — `brew install playwright-cli`. Forge is a wrapper, not a replacement.
- **macOS** for now (the managed-launch fallback targets `/Applications/Google Chrome.app`; the CDP-attach path works against any Chromium-family browser).
- **Node.js** — any recent version (tested on 24).

## Browser model

By default forge launches a fresh headed Chrome per Claude session, with a per-session profile under `$FORGE_ROOT/runs/<session-id>/profile/`. Two Claude sessions (e.g. across worktrees) get two independent browsers — no shared tabs, no shared profile, no fight over state. The browser stays open across forge calls in the same Claude session and is reused.

For "take-the-reins" mode where Claude acts on your everyday browser session, launch your Chromium-family browser (Chrome, Arc, Brave, Edge) with `--remote-debugging-port=9222`:

```bash
alias chrome='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.cache/chrome-cdp'
```

Then opt into attach mode by setting `FORGE_CDP_PORT=9222` in your env before invoking forge. `forge-session.sh` will attach to that browser instead of launching a managed one.

## Commands

| Command | Description |
|---------|-------------|
| `/forge <description>` | Drive a task end-to-end. Reuses existing snippets where they fit, authors new ones for novel steps. |
| `/forge snippet <name> [args]` | Cheap invocation of a known snippet — bypasses the agents, just runs the registry. |
| `/forge spec [url-or-description]` | *Optional export.* Drive the task (or work retrospectively from the session transcript) and synthesise a runnable `.spec.ts` — useful when a flow becomes worth pinning into CI. |
| `/forge doctor` | Read-only diagnostic checklist — confirms data root, snippet tiers, playwright-cli install, session state, and CDP browser presence. |

The skill also fires on natural-language phrases like `"use forge to ..."` — see [Invocation paths](#invocation-paths) for the routing tradeoff.

## How it works

Three single-purpose agents fan out from a Haiku-driven skill, with the session transcript as the contract between them. The driver does all the browser work; downstream agents read its log with full hindsight and produce snippets or specs.

```mermaid
flowchart TB
    User(["/forge &lt;task&gt;"])
    Skill["<b>forge skill</b><br/>orchestrator · Haiku"]

    subgraph agents["agents · Sonnet"]
        Driver["<b>driver</b><br/>drives the browser"]
        Author["<b>author</b><br/>writes snippets"]
        SpecWriter["<b>spec-writer</b><br/>writes specs"]
    end

    subgraph artifacts["artifacts on disk"]
        Transcript[("session transcript<br/>drove · invoked · note")]
        Library[("snippet library")]
        Specs[("specs/&lt;label&gt;.spec.ts")]
    end

    User --> Skill
    Skill -- "drive the task" --> Driver
    Driver -. "reads INDEX,<br/>invokes existing" .-> Library
    Driver -- "appends events" --> Transcript
    Skill -. "if novel work" .-> Author
    Skill -. "if spec mode" .-> SpecWriter
    Author -- "reads" --> Transcript
    Author -- "writes new snippets" --> Library
    SpecWriter -- "reads" --> Transcript
    SpecWriter -. "inlines snippet bodies" .-> Library
    SpecWriter -- "writes" --> Specs
```

- **Driver never authors.** It reads `INDEX.md`, invokes existing snippets where they fit, drives novel actions inline, and leaves a flat log. Naming, chunking, and intent-detection are downstream agents' jobs.
- **The transcript is the only contract.** Three event types — `drove` (raw browser actions), `invoked` (existing-snippet calls with args + result), `note` (optional driver annotations). The author and spec-writer consume it independently.
- **Author is conditional, spec-writer is mode-gated.** If the transcript contains only `invoked` events (library reuse was complete), the author is skipped. The spec-writer runs only when invoked via `/forge spec ...`.
- **Specs run without host project setup.** Generated specs run via `forge-spec.mjs run <label>` against an isolated Playwright workspace at `~/.claude/.vive-claude/forge/runner/`.

### Snippet lifecycle

```mermaid
flowchart LR
    Authored([authored]) --> Scratch[scratch/]
    Scratch -- "2nd use" --> Staged[staged/]
    Staged -- "3rd use" --> Library[library/]
    Scratch -. "7d unused" .-> Pruned([pruned])
    Staged -. "60d unused" .-> Scratch
    Library -. "90d unused" .-> Review([flagged for review])
```

New snippets land in `scratch/`. Repeat use promotes them — `library/` entries are never auto-deleted. Thresholds configurable via `FORGE_STAGE_AT` / `FORGE_LIBRARY_AT`; cleanup runs via `forge-registry.mjs prune`.

## Invocation paths

Forge exposes two routes, deliberately differentiated:

| Path | Trigger | Behaviour |
|---|---|---|
| **Slash** | `/forge:forge <description>` or `/forge:forge snippet <name>` | Runs entirely on Haiku — the `model: haiku` pin re-engages on every fresh slash invocation. |
| **Natural language** | `"use forge to ..."` | Session model (e.g. Opus) decides whether to trigger the skill; the skill body still runs on Haiku. |

The slash path is the cheap-and-predictable case for routine reuse. The natural-language path costs more on the first hit but is the discovery affordance — useful when you don't know the snippet name yet. Wall-time floor is browser I/O (typically 10–50s for a page navigation + scrape) regardless of path; on slash invocations, the model side is negligible relative to that floor.

## Use cases

The library accretes from real repetition. A few representative shapes:

- **Routine drudgery.** "Delete all emails from `noreply@noisy-vendor.com`."
- **PR / GitHub flows.** "Paste the GIF at `~/Desktop/demo.gif` into the description of PR #42."
- **Multi-step forms.** JIRA submissions, expense reports, deploy approval pages.
- **Triage and verification.** "Open the dashboard, check the error count, click into anything > 50, screenshot."
- **API-less integrations.** Apps without public APIs are still driveable via their UI. A snippet *is* the integration.

## Storage

Runtime data lives at `~/.claude/.vive-claude/forge/`:

```
~/.claude/.vive-claude/forge/
├── INDEX.md              # auto-generated retrieval index (name — description per line)
├── stats.json            # per-snippet { tier, useCount, lastUsed, createdAt }
├── scratch/              # see Snippet lifecycle above
├── staged/
├── library/
├── broken/               # quarantined after failed repair
├── sessions/             # per-Claude-session transcripts (drove + invoked + note events)
├── runs/<session-id>/    # per-Claude-session browser state — profile, session metadata
├── specs/                # generated `<label>.spec.ts` files
├── runner/               # bundled Playwright workspace used by `forge-spec.mjs run`
└── hints/                # optional domain hints — see below
```

Override the data root with `FORGE_ROOT=/some/other/path` — every script and every agent honors it. This is how other plugins can wrap forge (point at a side directory, invoke `forge:driver` / `forge:author` by name) without colliding with a standalone install.

Nothing here belongs in a git repo. Snippets may contain user-specific selectors, URLs, or paths captured during authoring — keep them off-disk-of-record.

## Domain hints

Drop markdown files into `$FORGE_ROOT/hints/` to inject domain knowledge into the agents. Each agent reads `hints/project.md` (shared) plus its own role-specific file at the start of every run:

| File | Read by | Use for |
|---|---|---|
| `hints/project.md` | all three agents | environment setup, base URLs, credential env vars, command wrapping (e.g. `direnv exec ...`) |
| `hints/driver.md` | driver | live UI quirks, click workarounds, wait patterns |
| `hints/author.md` | author | snippet conventions, naming rules, must-include wait patterns, POM composition |
| `hints/spec-writer.md` | spec-writer | fixture imports, spec naming conventions, assertion style |

All four are optional — standalone forge with no `hints/` directory is unaffected. Keep each file short and reviewable; this is a prompt-injection surface for every agent run.

## Credentials & secrets

playwright-cli's `run-code` sandbox does NOT expose Node's `process.env`. Naive `process.env.PASSWORD` inside a drive block resolves to `undefined`, and direct `playwright-cli fill` of literal credentials leaks them into the transcript verbatim. Forge solves both via env injection:

**Driver side**: pass `--env KEY` per env var on every `drive run-code` invocation that needs them.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive run-code \
  "async page => { await page.getByLabel('Username').fill(process.env.PORTAL_USERNAME); }" \
  --env PORTAL_USERNAME
```

Forge resolves the value at the Node layer (where direnv-loaded env is visible), wraps the user's code with a `process` shim into the sandbox, and records only the original code (with `process.env.X` refs intact) to the transcript. Literals never reach disk.

**Snippet side**: snippets that read credentials declare them in `meta.envKeys`. The author agent populates this automatically from drove events that used `--env`.

```ts
export const meta = {
  description: "...",
  envKeys: ['PORTAL_USERNAME', 'PORTAL_PASSWORD'],
  args: {},
}
```

When the snippet is later invoked, forge resolves the env vars and shims `process.env` into the sandbox, same shape as the drive `--env` flow. Cheap reuse, no plumbing per call.

Both mechanisms require the env vars to be set when the bash invocation runs. Wrap with your env-loading mechanism if needed (e.g. `direnv exec ~/project ...`).

## Wrapping forge for project-specific use

Forge is domain-agnostic; project-specific knowledge belongs in a wrapper plugin. To wrap:

1. **Point `FORGE_ROOT` at a side directory** owned by your project (e.g. `~/myproject/.forge/`). All forge scripts and agents honor it; your project's snippet library, transcripts, and managed Chrome profile stay isolated from a standalone forge install.
2. **Seed `$FORGE_ROOT/hints/`** with project-specific facts the agents need — base URLs, auth env var names, repo layout, known UI quirks.
3. **Invoke `forge:driver` and `forge:author` by name** from your wrapper skill, passing `FORGE_ROOT` and `FORGE_SESSION` in their prompts. Your wrapper handles the orchestration and any project-specific spec composition.

Both forge agents read `$ROOT/hints/project.md` plus their role-specific hint file on every run. Snippets authored by the wrapped instance live in the wrapper's `FORGE_ROOT`, not in standalone forge's. The two libraries never collide.

## License

MIT
