# Session state machine

`forge-session.sh` is the single source of truth for "does the `forge` playwright-cli session exist, and what's it attached to?".

## States

```
                  ┌──────────────┐
                  │  caller asks │
                  │  for browser │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────────┐  yes  ┌──────────────────────────┐
                  │ playwright-cli   ├──────►│  EXISTING                │
                  │ list grep forge│       │  reuse the named session │
                  └──────┬───────────┘       └──────────────────────────┘
                         │ no
                         ▼
                  ┌──────────────┐    yes    ┌──────────────────────────┐
                  │ probe :9222  ├──────────►│  CDP-ATTACHED            │
                  └──────┬───────┘           │  attach --cdp to user's  │
                         │ no                │  Chromium-family browser │
                         ▼                   └──────────────────────────┘
                  ┌──────────────┐
                  │ --probe-only │  yes  →  exit 1 (caller decides)
                  └──────┬───────┘
                         │ no
                         ▼
                  ┌──────────────────────┐
                  │  LAUNCHED            │
                  │  open --persistent   │
                  │  --profile=<forge  │
                  │  chromium-profile>   │
                  └──────────────────────┘
```

## Endpoint output

A single line of JSON to stdout on success:

```json
{ "mode": "existing" | "cdp-attached" | "launched", "session": "forge", "port"?: 9222, "profile"?: "..." }
```

The `mode` field is the signal:

- `"existing"` — a `forge` session was already in playwright-cli's list. Reuse as-is.
- `"cdp-attached"` — we attached to a CDP-enabled browser the user launched themselves. **Treat with care:** the session holds real cookies, real auth, real personal context. Side effects propagate to the user's actual browsing.
- `"launched"` — we launched a managed Chrome with a dedicated `--profile=$FORGE_PROFILE`. Profile persists across runs but is isolated from the user's everyday browser.

## When to probe vs launch

- **`--probe-only`** before any invocation. If nothing's listening and no session exists, *ask the user* before launching. Browser windows appearing without warning is jarring.
- **No flag** only after the user has approved. The script is idempotent — running it when the session is already alive returns the `existing` mode.
- **`--managed`** skips the CDP probe and goes straight to managed launch. Use when the snippet *must not* run against the user's personal session (testing flows that would interfere with their real GitHub state, demonstrating a hermetic flow, etc.). Today this is a manual choice.

## Failure modes

| Exit code | Meaning | Remedy |
|---|---|---|
| 0 | Endpoint printed to stdout | — |
| 1 | `--probe-only` and no session can be established without launching | Caller decides whether to launch |
| 2 | Unknown CLI arg | Fix the call |
| 3 | `attach --cdp` failed (browser on port isn't Chromium-family) | Launch managed or close the conflicting browser |
| 4 | Managed launch failed | Investigate manually — check `playwright-cli list`, Chrome install |
| 5 | playwright-cli not installed | `brew install playwright-cli` |

## Sharing the session

The whole point of a named playwright-cli session is that *multiple* clients can act on the same browser:

- `forge-registry.mjs invoke` shells out to `playwright-cli -s=forge run-code "..."`
- The `forge:snippet-author` agent drives via `playwright-cli -s=forge <action>`
- The user, if attached to their own Chrome, sees and can click in the same window
- Future agents and `/spec` workflows use the same session name

None of these own the session beyond their own command. Lifecycle (close, detach, delete-data) is the user's call, not Claude's.

## CDP-enabled browsers

For "take-the-reins" mode, the user's everyday browser needs to be running with `--remote-debugging-port=9222`. For Chromium-family browsers:

- **Google Chrome** — launch with `--remote-debugging-port=9222 --user-data-dir=<somewhere>` (user-data-dir is required by Chrome for non-default debug-port use).
- **Arc** — Arc is Chromium-based; same flag works. Most users set up a launchd / shell alias once.
- **Brave / Edge / Chromium** — same flag.
- **Firefox / Safari** — different protocols; not supported by `attach --cdp`. Would need `attach --endpoint` or `attach --extension`.

If the user hasn't set up their everyday browser for CDP, the managed-launch path is fine — they just get a separate persistent profile.
