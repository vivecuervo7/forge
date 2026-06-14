# internet — exemplar for public, no-auth interaction-class probing

This sample is a `forge/`-shaped directory showing what a good setup looks like for a site of small isolated interaction patterns — dialogs, drag-and-drop, shadow DOM, async loading, framed editors. The target is [the-internet.herokuapp.com](https://the-internet.herokuapp.com), a deliberately-built playground for classic-hard browser interactions.

**If your project is probe-shaped (many small interactions, no transactional flows, no auth), mirror this sample.**

## What's here

| File | Purpose |
|---|---|
| [`hints/driver.md`](./hints/driver.md) | A per-probe map (interaction class → path), known gotchas (HTML5 drag-and-drop's `dispatchEvent` fallback, dialog-listener ordering, iframe descent), and the public test credentials for the login probe. **Shows what a `driver.md` looks like when it's a guidebook rather than a selector dump.** |
| `playwright.config.ts` | Scaffolded by `/forge init`. |
| `.gitignore` | Scaffolded by `/forge init`. |

## What's not here yet

The `snippets/` directory will be populated when you run forge against this target. To generate it yourself, drive any of the probes:

```
cd samples/internet
/forge log in as tomsmith
/forge open the shadow DOM page and capture the first list item
/forge accept the JS alert and capture the result text
```

Each drive will accrete a snippet (or several) into `snippets/`, parameterised along whatever dimensions the hint flagged as variants.

## What this exemplar demonstrates

**The hint file's job is to encode coverage intent, not to teach Playwright.** The bare driver already picks `data-test` selectors over text matchers, uses modern Playwright primitives, and pierces shadow DOM correctly. Your hint file is for what the driver can't derive from looking at the page — variants worth parameterising over, defensive patterns your team has learned the hard way, known framework quirks.

A good illustration in this sample: the hint flags HTML5 drag-and-drop's `dragTo` as unreliable on the target page, so a drag-and-drop snippet should use `dispatchEvent` instead — even though `dragTo` happens to work. **Useful if your team has real production pain with one approach; informative if your hint has a stale rule.** Audit hints periodically.

## How to read this sample for your own project

1. **Open `hints/driver.md`** and notice it's mostly a guidebook of "here's how to do X on this kind of page" rather than a selector dump. For a probe-shaped surface, that's the right shape.

2. **When you author your own snippets** (or watch forge author them after a drive), ask: "what dimension would a future caller want to vary?" — and make that an arg. The hint's variant documentation gives snippet-author concrete dimensions to parameterise over.

3. **For auth-bearing scenarios**, see the [shop sample](../shop/) where auth is meaningful and multi-account scenarios apply.

## Why this hint shape — findings from earlier runs

Earlier forge runs against this target (design-phase field tests) gave us evidence for several choices the hint encodes:

- **The bare driver already handles modern Playwright idioms.** Drives against five probes in this collection (login, dynamic loading, JS alerts, drag-and-drop, shadow DOM) all succeeded without a `driver.md` — five for five. The bare driver picks `data-test` / `#id` selectors over text matchers, uses modern primitives (`dragTo`, `page.once('dialog', d => d.accept())` ordered before the click, `<select>` options for React date pickers), and pierces shadow DOM via plain `locator()`. **The hint file is not for teaching Playwright** — it's for encoding coverage intent and project-specific gotchas the driver can't derive from looking at the page.

- **Hints shape parameterisation, not pass-rate.** With probes flagged as variants in the hint (`dialogAction = accept | dismiss`, dynamic-loading `variant = 1 | 2`, drag-and-drop `sourceId` / `targetId`), snippet-author writes generic snippets. Without the hint, snippet-author scopes each snippet to the specific case the driver encountered. **Same drives, different snippet shape** — and snippet shape determines whether future specs compose cleanly or have to write fresh code each time.

- **Defensive choices encoded in hints stick.** The hint flags HTML5 drag-and-drop's `dragTo` as unreliable on the target page, so the resulting snippet uses `dispatchEvent` instead. Earlier runs confirmed both approaches work on this page — the hint encodes a defensive preference rather than a fix. Useful if your team has real production pain with the easier primitive; informative if your hint has a stale rule.
