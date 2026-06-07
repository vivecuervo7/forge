# forge

A browser assistant for repeatable user actions.

`forge` lets Claude drive your live browser session — fill the form you fill every week, paste a GIF into a PR description, delete all the marketing emails from one sender, navigate a five-step UI you'd rather not click through again. Whatever the action, the first time Claude does it, forge captures the path as a small `.ts` snippet. Next time you ask, it's already in the library; one fast invocation rather than a fresh investigation.

Specs and connectors are downstream of this. If a flow becomes worth pinning into CI, forge can generate a real Playwright spec from a recorded drive. If you want an API for an app that doesn't have one, a snippet *is* your API — just driven through the UI Claude already knows.

The plugin owns the *browser as a long-lived daemon*: you attach (or launch) once, and Claude, you, and any future tooling all act on the same window via the named `forge` playwright-cli session.

## Status

Foundation laid; iteration ongoing. Today the plugin ships:

- A `forge` skill — thin router. Triggered automatically on "use forge to ..." phrases AND invokable as a slash command. Three routes:
  - `/forge snippet <name> [args]` — explicit cheap invocation of a known snippet (bypasses the driver agent entirely; just runs the registry).
  - `/forge spec [url-or-description]` — synthesises a Playwright `.spec.ts` from session activity (retrospective) or by driving a fresh description (prospective).
  - Anything else (`/forge <description>` or `"use forge to ..."`) — hands off to the `forge:driver` agent for end-to-end execution.
- A `forge:driver` agent — owns multi-step browser tasks end-to-end. Reads `INDEX.md`, decomposes the task, invokes existing snippets where they fit, drives inline (via `forge-registry.mjs drive`) for steps without a matching snippet. Returns the task's outcome. Never invents snippets mid-flow.
- A session helper — probes `localhost:9222` for an existing CDP-enabled browser (attach `--cdp`), falls back to launching managed Chrome (headed) with a dedicated persistent profile.
- A snippet registry — `list`, `show`, `reindex`, `invoke`, `delete`, `prune`, `drive` (wraps playwright-cli and records actions to the transcript), `collate` (heuristic post-driver pass that auto-creates snippets from drove-event patterns). Invocation runs through `playwright-cli -s=forge run-code "..."` with precondition checks prepended, args inlined, and the right tab picked (or opened) so pinned/bookmarked tabs are never hijacked.
- **Drive-then-collate snippet creation.** During a driver run, actions that don't match an existing snippet are driven inline via `forge-registry.mjs drive` and recorded to the transcript. After the run completes, `forge-registry.mjs collate` scans consecutive drove-event groups and auto-creates snippets in `scratch/` for groups that look reusable (action count, has navigation/extraction, not a duplicate of existing). No mid-flow author decisions; the library grows from observed patterns.
- **Promotion machinery** — snippets auto-graduate `scratch → staged → library` on repeat use (configurable via `FORGE_STAGE_AT` / `FORGE_LIBRARY_AT`).
- **TTL cleanup** — `forge-registry.mjs prune` removes unused scratch snippets (7d), demotes stale staged ones (60d), flags stale library entries (90d) for review.
- **Session transcripts** — every `invoked`, `authored`, and `drove` event lands in `~/.claude/.vive-claude/forge/sessions/<CLAUDE_CODE_SESSION_ID>.jsonl`. The spec pipeline and the collation pass both consume this transcript; users never need to manage it.

Coming: a dedicated `snippet-repair` agent for DOM drift; a `forge-spec.mjs run` subcommand + bundled runner workspace so generated specs are runnable without needing a host project setup.

## Invocation paths and cost shape

Forge exposes two routes, deliberately differentiated by cost:

| Path | Trigger | Cost shape | When to reach for it |
|---|---|---|---|
| **Slash** | `/forge:forge snippet <name>` or `/forge:forge <description>` | Runs entirely on Haiku, every call — the `model: haiku` pin re-engages on every fresh slash invocation. Routine invocations stay cheap across the whole session. | You know what you want. Routine reuse of known snippets, scripted workflows, anything you reach for repeatedly. |
| **Natural language** | `"use forge to ..."` | Session model (e.g. Opus) decides whether to trigger the skill, then the skill body runs on Haiku. First call carries a session-model surcharge; subsequent calls in the same session fall back to the session model entirely (the pin only fires on fresh skill invocations). | Discovery, multi-turn refinement, requests that may need authoring, anything where you don't know the snippet name yet. |

*Illustrative figures (Opus 4.7 session, single invocation, late-2026 pricing):*

| Invocation | Cost | Notes |
|---|---|---|
| `/forge:forge snippet hn-first-story-comments` | ~$0.03 | Direct, named — cheapest. |
| `/forge:forge get the first item on HN` | ~$0.03 | NL via slash — Haiku does the matching, still cheap. |
| `Use forge to get the first item on HN` | ~$0.34 | Model-invoked — Opus pays to recognise the trigger phrase. |

Wall-time floor is browser I/O (typically 10-50s for a page navigation + scrape), regardless of which path you take. On slash invocations, the model side is now small enough to be negligible relative to that floor.

The cost asymmetry is by design: cheap execution for the common case, more-expensive discovery affordance available when you need it. The plugin's central value — *don't re-drive what's already been driven* — is delivered most cheaply via the slash path.

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
