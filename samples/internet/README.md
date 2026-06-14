# internet — exemplar for public, no-auth interaction-class probing

This sample is a `forge/`-shaped directory showing what a good setup looks like for a site of small isolated interaction patterns — dialogs, drag-and-drop, shadow DOM, async loading, framed editors. The target is [the-internet.herokuapp.com](https://the-internet.herokuapp.com), a deliberately-built playground for classic-hard browser interactions.

**If your project is probe-shaped (many small interactions, no transactional flows, no auth), mirror this sample.**

## What's here

| File | Purpose |
|---|---|
| [`hints/driver.md`](./hints/driver.md) | A per-probe map (interaction class → path), known gotchas (HTML5 drag-and-drop's `dispatchEvent` fallback, dialog-listener ordering, iframe descent), and the public test credentials for the login probe. **Shows what a `driver.md` looks like when it's a guidebook rather than a selector dump.** |
| `playwright.config.ts` | Scaffolded by `/forge init`. |
| `snippets/dynamic-loading-start-and-capture.ts` | **Seeded** — produced by a real forge run. Parameterised on `variant: '1' \| '2'` so one snippet covers both example pages. |

## Walkthrough — see how the hint shapes snippet generality

Run these from inside `samples/internet/`.

### 1. Library reuse — variant 2 reuses the seed

```
/forge load the second dynamic loading variant and capture the rendered text
```

The driver finds the seeded snippet and invokes it with `variant: '2'`. No new authoring.

**What to look for:** one "invoked" step, no new files in `snippets/`.

**What this demonstrates:** when the hint flags a variant in advance, snippet-author writes a single parameterised snippet that covers the variant space. Future tasks that hit any variant reuse the same snippet.

### 2. Fresh authoring — drive a different probe

```
/forge accept the JS alert and capture the result text
```

Different probe (JS alerts), no library coverage yet. Snippet-author authors a new snippet.

**What to look for:** a new `snippets/javascript-alerts-confirm-and-capture.ts` (or similarly-named) appears.

**What this demonstrates:** the bare driver already handles modern Playwright idioms (`page.once('dialog', d => d.accept())` ordered before the click is the canonical pattern). The hint's job is to encode coverage intent and project-specific gotchas — not to teach Playwright.

### 3. Optional — keep going

```
/forge open the drag-and-drop page and swap columns A and B
/forge open the shadow DOM page and capture the first list item
```

Each adds a snippet. The hint flags HTML5 `dragTo` as unreliable on this page, so the drag-and-drop snippet should use `dispatchEvent` instead — even though `dragTo` happens to work here. Useful if your team has real production pain with one approach; informative if your hint has a stale rule.

## Why this hint shape — findings from earlier runs

Earlier forge runs against this target (design-phase field tests) gave us evidence for several choices the hint encodes:

- **The bare driver already handles modern Playwright idioms.** Drives against five probes in this collection (login, dynamic loading, JS alerts, drag-and-drop, shadow DOM) all succeeded without a `driver.md` — five for five. The bare driver picks `data-test` / `#id` selectors over text matchers, uses modern primitives (`dragTo`, `page.once('dialog', d => d.accept())` ordered before the click, `<select>` options for React date pickers), and pierces shadow DOM via plain `locator()`. **The hint file is not for teaching Playwright** — it's for encoding coverage intent and project-specific gotchas the driver can't derive from looking at the page.

- **Hints shape parameterisation, not pass-rate.** With probes flagged as variants in the hint (`dialogAction = accept | dismiss`, dynamic-loading `variant = 1 | 2`, drag-and-drop `sourceId` / `targetId`), snippet-author writes generic snippets. Without the hint, snippet-author scopes each snippet to the specific case the driver encountered. **Same drives, different snippet shape** — and snippet shape determines whether future specs compose cleanly or have to write fresh code each time.

- **Defensive choices encoded in hints stick.** The hint flags HTML5 drag-and-drop's `dragTo` as unreliable on the target page, so the resulting snippet uses `dispatchEvent` instead. Earlier runs confirmed both approaches work on this page — the hint encodes a defensive preference rather than a fix. Useful if your team has real production pain with the easier primitive; informative if your hint has a stale rule.

## For auth-bearing scenarios

This target has no auth. See the [shop sample](../shop/) for the auth + multi-account pattern.
