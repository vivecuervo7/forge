# forge

A browser assistant for repeatable user actions.

`forge` lets Claude drive your live browser session — fill the form you fill every week, paste a GIF into a PR description, delete all the marketing emails from one sender, navigate a five-step UI you'd rather not click through again. Whatever the action, the first time Claude does it, forge captures the path as a small `.ts` snippet. Next time you ask, it's already in the library; one fast invocation rather than a fresh investigation.

Specs and connectors are downstream of this. If a flow becomes worth pinning into CI, forge can generate a real Playwright spec from a recorded drive. If you want an API for an app that doesn't have one, a snippet *is* your API — just driven through the UI Claude already knows.

The plugin owns the *browser as a long-lived daemon*: you attach (or launch) once, and Claude, you, and any future tooling all act on the same window via the named `forge` playwright-cli session.

## Status

Foundation laid; iteration ongoing. Today the plugin ships:

- A `forge` skill — single unified entry point. Triggered automatically on "use forge to ..." phrases AND invokable as a slash command. Two modes:
  - `/forge snippet <name> [args]` — explicit cheap invocation of a known snippet. Re-engages a Haiku model pin on every call, so repeated invocations stay cheap across the session.
  - `/forge <description>` or `"use forge to ..."` — natural-language flow. Reads `INDEX.md`, matches the request to existing snippets (with arg overrides where they fit), composes multi-step requests across snippets, and delegates fresh authoring to an agent when no snippet covers the request.
- A session helper — probes `localhost:9222` for an existing CDP-enabled browser (attach `--cdp`), falls back to launching managed Chrome with a dedicated persistent profile (`open --persistent --profile=...`).
- A snippet registry — list, show, reindex, invoke, record-authoring, delete, prune. Invocation runs through `playwright-cli -s=forge run-code "..."` with precondition checks prepended, args inlined, and the right tab picked (or opened) so pinned/bookmarked tabs are never hijacked.
- A `snippet-author` agent — drives the `forge` session via playwright-cli, captures the working path into a `.ts` file in `scratch/`, records the drive as the snippet's first use, and returns a structured summary. DOM exploration noise stays in the agent's context window.

Coming: scratch → staged → library auto-promotion on reuse, TTL cleanup of unused snippets, `snippet-repair` for self-healing under DOM drift, session recorder, and `/spec from-session` for generating frozen Playwright specs.

## Install

```bash
claude plugin marketplace add vivecuervo7/claude-plugins
claude plugin install forge@vive-claude
```

First use bootstraps a data root under `~/.claude/.vive-claude/forge/`. The bootstrap is idempotent.

## Requirements

- **playwright-cli** — `brew install playwright-cli`. Forge is a wrapper, not a replacement.
- **macOS** for now (the managed-launch fallback targets `/Applications/Google Chrome.app`; the CDP-attach path works against any Chromium-family browser).
- **Node.js** (any recent version — tested on 24).

## Attaching to your existing browser

For "take-the-reins" mode where Claude acts on the browser session you've been using, launch your everyday Chromium-family browser (Chrome, Arc, Brave, Edge) with `--remote-debugging-port=9222`:

```bash
# Example shell alias for everyday Chrome:
alias chrome='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.cache/chrome-cdp'
```

When `forge-session.sh` runs and detects the CDP port, it'll attach. You stay in control; Claude takes the wheel when you ask.

If you'd rather Claude drive a separate browser (real cookies stay yours), skip the CDP setup and `forge-session.sh` will launch a managed Chrome with its own persistent profile.

## Use cases

The library accretes from real repetition. A few representative shapes:

- **Routine drudgery.** "Delete all emails from `noreply@noisy-vendor.com`." Claude drives Gmail, captures the path; next month, one-line invocation.
- **PR / GitHub flows.** "Paste the GIF at `~/Desktop/demo.gif` into the description of PR #42." A snippet authored once handles every future PR description paste.
- **Multi-step forms.** Five-tab JIRA submissions, expense reports, deploy approval pages. Snippet remembers which fields go where.
- **Triage and verification.** "Open the dashboard, check the error count, click into anything > 50, screenshot." Becomes a one-line check.
- **API-less integrations.** Apps without public APIs are still driveable via their UI. A snippet *is* the integration.

The "use it again" reuse signal is the cheap-and-good promotion criterion (see the storage section). Things you do once and never again live and die in `scratch/`. Things you find yourself asking for repeatedly graduate to `staged/`, then `library/`.

## Storage

Runtime data lives at `~/.claude/.vive-claude/forge/`:

```
~/.claude/.vive-claude/forge/
├── INDEX.md              # auto-generated retrieval index (name — description per line)
├── stats.json            # per-snippet { tier, useCount, lastUsed, createdAt }
├── scratch/              # 7-day TTL (cleanup wired up in a later step)
├── staged/               # promoted on second use
├── library/              # promoted on third use; never auto-deleted
├── broken/               # quarantined after failed repair
├── sessions/             # recorder transcripts (future)
└── chromium-profile/     # dedicated profile for managed-launch fallback
```

Nothing here belongs in a git repo. Snippets may contain user-specific selectors, URLs, or paths captured during authoring — keep them off-disk-of-record.

## License

MIT
