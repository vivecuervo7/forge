# Forge samples

Reference outputs from running forge against three deliberately-different web targets, with two or three different hint approaches per target. Browse these to calibrate what your own hint files should look like and what kind of artifacts forge produces in return.

## The three targets

| Target | Site | What it stresses |
|---|---|---|
| [`internet/`](./internet) | [the-internet.herokuapp.com](https://the-internet.herokuapp.com) | Classic interaction-class probes — dialogs, drag-and-drop, shadow DOM, async loading, frames |
| [`widgets/`](./widgets) | [demoqa.com](https://demoqa.com) | Legacy-widget gauntlet — React date pickers, jQuery UI sortable, Bootstrap modals, autocomplete chips |
| [`shop/`](./shop) | [practicesoftwaretesting.com](https://practicesoftwaretesting.com) | Real-app middle ground — Angular SPA with JWT auth, multi-step checkout, 5 payment methods |

## The runs

Each target has two or three `run-N/` directories representing the same task driven with progressively richer hint sets:

- **`run-1/`** — bare-minimum hints. No `driver.md` at all where the site is public; just the auth env contract in `forge.md` for sites that require login.
- **`run-2/`** — comprehensive hints written after a manual exploration of the app (roughly one hour of clicking around, noting selectors and gotchas).
- **`run-3/`** (shop only) — comprehensive hints derived directly from the app's official documentation rather than manual exploration.

Each run-N directory contains:

- `README.md` — what hints were in place, what forge produced, and what the output tells you about hint quality.
- `hints/` — the exact hint files forge consumed (so you can see what bare vs comprehensive looks like as text).
- `snippets/` — every snippet forge authored during the run.
- `specs/` — every spec forge composed (spec-mode runs only).

## What to take away

The shop run-1 → run-2 → run-3 progression is the clearest demonstration of why hint quality matters. Same checkout task each time, three different hint sets, three qualitatively different specs.

A few patterns the samples make concrete:

- **Selector vocabulary in `driver.md` shapes the snippet library.** When the hint lists `a[data-test^="product-"]` as the canonical product-card selector, snippet-author tends to write `open-first-search-result` as its own snippet. When the hint doesn't, snippet-author tends to fuse product-selection into a larger `add-product-to-cart` snippet that requires a hardcoded URL. The first composition survives inventory rotation; the second doesn't.
- **The driver picks modern Playwright idioms by default.** Look at the run-1 snippets: `dragTo` for HTML5 drag-and-drop, `page.once('dialog')` ordered before the trigger click for JS alerts, plain `locator('li').first()` for shadow-DOM piercing. You don't need to teach forge these idioms; they're already in the agent's defaults. Your `driver.md` is for the project-specific stuff that's harder to discover.
- **Hint-flagged framework quirks become first-try-pass on specs.** Shop run-2 needed two verifier iterations to discover the Angular `dispatchEvent` two-click pattern on the checkout `finish` button. Shop run-3, with the same gotcha documented up-front in `driver.md`, baked the pattern into the first drive — the spec verified from a cold start on the first try.

## How to use these as a template for your own hints

1. Pick the target closest to your app (internet for low-complexity, widgets for legacy-widget-heavy, shop for modern SPAs with auth).
2. Open its `run-2/hints/` files alongside `run-1/`. The diff is what comprehensive hints add over bare-minimum.
3. For an even sharper template, read `shop/run-3/hints/` — those are the cleanest hint files in the collection, derived from a documentation-grounded approach you can replicate by reading your own app's docs.
4. Author your own `forge/hints/{driver,forge}.md` in the same shape. Skip sections that don't apply (the smaller hint files — `snippet-author.md`, `spec-writer.md`, `spec-verifier.md` — are usually unnecessary; defaults cover them).

The full hint-authoring guidance lives in [`../templates/init/hints-README.md`](../templates/init/hints-README.md), which is also the file `/forge init` drops into every new project's `forge/hints/` directory.
