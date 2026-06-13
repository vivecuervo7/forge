# internet / run-1 — bare-minimum hints

**Hint set in place:** none. The site is fully public; no auth, no provisioning recipe needed. Slot minted from the default empty recipe.

## Probes driven

Five drives, each one a separate `/forge <task>` invocation:

| Probe | Class | Drive prompt |
|---|---|---|
| `/login` | Auth baseline | `open the-internet.herokuapp.com/login and sign in as tomsmith with password SuperSecretPassword!` |
| `/dynamic_loading/1` | Async rendering | `open /dynamic_loading/1, click Start, and capture the text that appears after the loading bar finishes` |
| `/javascript_alerts` | Native dialog | `open /javascript_alerts, accept the second alert (JS Confirm), and capture the result text on the page` |
| `/drag_and_drop` | HTML5 drag-and-drop | `open /drag_and_drop and swap boxes A and B` |
| `/shadowdom` | Shadow root | `open /shadowdom and capture the first list item's text` |

## Results

All five drove cleanly with no STUCK escalations. Forge authored one snippet per probe:

| Probe | Snippet | Notes |
|---|---|---|
| `/login` | `login-as-user.ts` | Args: `username`, `password`. Clean. |
| `/dynamic_loading/1` | `dynamic-loading-1-capture-text.ts` | Waits on `#finish` visibility before reading text. |
| `/javascript_alerts` | `accept-js-confirm-alert.ts` | Registers `page.once('dialog')` accept handler **before** clicking the trigger — got the ordering right first try. |
| `/drag_and_drop` | `drag-and-drop-swap-columns.ts` | Used native Playwright `dragTo` directly. |
| `/shadowdom` | `capture-shadowdom-list-item-text.ts` | Plain `page.locator('li').nth(index)` — Playwright pierces the shadow DOM automatically. |

## What this tells you

The bare driver, with no hints at all, picked modern Playwright primitives correctly across every probe. `dragTo` for HTML5 drag-and-drop, `page.once('dialog')` ordered before the click for native alerts, the plain locator for shadow-DOM piercing — all of these are non-obvious choices the agent's defaults already cover.

So when you adopt forge against a new app, **you don't need to teach it Playwright idioms**. What you do need to teach it is the project-specific stuff: which selectors are stable, which routes lead where, which framework quirks bite. See `run-2/` for what that looks like.

## Artifacts

- `snippets/` — 5 snippets, one per probe
- No `specs/` (drive mode, not spec mode)
- No `hints/driver.md` (this was the bare-minimum run)
