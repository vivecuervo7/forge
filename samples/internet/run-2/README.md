# internet / run-2 — comprehensive hints

**Hint set in place:** `hints/driver.md` with a per-probe map (12 interaction classes mapped to paths), known gotchas (HTML5 drag-and-drop's dispatchEvent fallback, dialog-listener ordering, iframe descent, TinyMCE inside an iframe), and the public-by-design test credentials for the login probe.

Working tree wiped before this run so the comparison with `run-1/` is apples-to-apples — same five probes, same prompts, fresh snippet library.

## Results

All five probes drove cleanly, same as run-1. Five snippets authored:

| Probe | Snippet | Δ vs run-1 |
|---|---|---|
| `/login` | `login.ts` | Args now default to the public `tomsmith`/`SuperSecretPassword!` (hint flagged credentials as page-documented). Cleaner caller ergonomics — invocation site doesn't need to pass them. |
| `/dynamic_loading/1` | `dynamic-loading-start-and-capture.ts` | Parameterised on `variant` ('1' or '2') — covers both example variants the hint's probe map flagged. |
| `/javascript_alerts` | `javascript-alerts-confirm-and-capture.ts` | Parameterised on `dialogAction` ('accept' or 'dismiss'). |
| `/drag_and_drop` | `drag-and-drop-swap.ts` | Used the hint's recommended dispatchEvent pattern instead of `dragTo`. Accepts arbitrary `sourceId`/`targetId` args — generic to any similar HTML5 DnD page, not just this specific one. |
| `/shadowdom` | `shadowdom-capture-first-list-item.ts` | Same approach as run-1; the hint reinforced rather than changed the choice. |

## What this tells you

Look at the snippet *args* between run-1 and run-2. Same drives, but:

- Run-1 snippets are scoped to the exact thing the driver encountered.
- Run-2 snippets are parameterised along dimensions the hint flagged as variants — `variant`, `dialogAction`, `sourceId`/`targetId`.

The hint file's job here isn't to fix things the driver got wrong (it didn't). It's to **encode coverage intent** so the snippet library accumulates reusable building blocks rather than scenario-specific ones.

There's also a behavioural divergence worth seeing in the drag-and-drop snippet: run-1 used `dragTo` (which works); run-2 used `dispatchEvent` (because the hint flagged `dragTo` as unreliable). The hint locks in a defensive choice even when an easier primitive happens to work — useful when the hint encodes real production pain, instructive to know if your hint has a stale rule.

## Artifacts

- `hints/driver.md` — the comprehensive hint set in place
- `snippets/` — 5 snippets, one per probe, more reusable than run-1's
