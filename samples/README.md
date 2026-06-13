# Forge samples

Reference outputs from running forge against three deliberately-different web targets, with two or three progressively richer hint approaches per target. This README summarises what the samples collectively show; each per-run subdirectory has its own README with the specifics.

## The three targets

| Target | Site | What it stresses |
|---|---|---|
| [`internet/`](./internet) | [the-internet.herokuapp.com](https://the-internet.herokuapp.com) | Classic interaction-class probes — dialogs, drag-and-drop, shadow DOM, async loading, frames |
| [`widgets/`](./widgets) | [demoqa.com](https://demoqa.com) | Legacy-widget gauntlet — React date pickers, jQuery UI sortable, Bootstrap modals, autocomplete chips |
| [`shop/`](./shop) | [practicesoftwaretesting.com](https://practicesoftwaretesting.com) | Real-app middle ground — Angular SPA with JWT auth, multi-step checkout, 5 payment methods |

## Run convention

Each target has two or three `run-N/` directories representing the same task driven with progressively richer hint sets:

- **`run-1/`** — bare-minimum hints. No `driver.md` at all where the site is public; just the auth env contract in `forge.md` for sites that require login.
- **`run-2/`** — comprehensive hints written after a manual exploration of the app.
- **`run-3/`** (shop only) — comprehensive hints derived directly from the app's official documentation rather than manual exploration.

Each run directory contains `README.md` (what hints were in place, what forge produced, what the output tells you), `hints/` (the exact hint files), `snippets/` (every snippet authored), and `specs/` (every spec composed — spec-mode runs only).

## Headline finding

**Doc-grounded comprehensive hints take spec-mode forge from "iterate to discover quirks" to "first-try pass."**

The shop target was driven through the same multi-step checkout three times:

| Run | Hint approach | What the spec did | Verifier iterations |
|---|---|---|---|
| `shop/run-1/` | minimal (auth only) | Drove correctly. Spec hardcoded the specific product URL the driver navigated to. | Several |
| `shop/run-2/` | hand-written from exploration | Drove correctly. Spec composed `search → open-first → add`, robust to inventory drift. | A few |
| `shop/run-3/` | rewritten from official docs | Same composition as run-2. Plus the Angular zone.js / dispatchEvent quirk baked into the first drive from the hint, so no quirk discovery needed during verification. | **Zero. Passed in 22.5s.** |

That progression — same task, same site, three increasingly thoughtful hint sets — is the single sharpest demonstration of why hint quality matters.

## What the bare driver already does well

Across `run-1/` on every target, the bare driver — given no `driver.md` at all — got these right consistently:

- **Picked `data-test` / `#id` selectors over text matchers** where the markup offered them.
- **Picked modern Playwright primitives for hard widgets**: `dragTo` for HTML5 drag-and-drop, `page.once('dialog', d => d.accept())` ordered before the click for native alerts, native `<select>` options for React date pickers, incremental mouse-move for jQuery UI sortable. These are 2024-era idioms; the agent's defaults already cover them.
- **Pierced shadow DOM via plain `locator()`** — no manual descent needed; modern Playwright handles it.
- **Discovered framework quirks experimentally**: on the shop's Angular checkout, the bare driver figured out that `.click()` on the `finish` button didn't fire Angular's binding and pivoted to `dispatchEvent`. It got there by trial and error, but it got there.

What this means: **when you adopt forge against a new app, you don't need to teach it Playwright idioms.** The agent's defaults cover those. Your hint files are for the project-specific stuff that's harder to derive from the app itself.

## What comprehensive hints add (run-2 across all targets)

Across `run-2/` on every target, hints didn't change which probes passed — bare drivers already passed everything. What they changed:

- **Snippet parameterisation.** Hint-flagged variants (modal `size`, sortable `listSelector`, dialog `dialogAction`) became `args` instead of hardcoded values. The snippets cover more cases.
- **Snippet decomposition.** Where the hint listed selectors per element class, snippet-author authored one snippet per element-class action. The library has more single-responsibility pieces.
- **Defensive code.** Hint-flagged risks (ad-occlusion on demoqa, async store updates on the shop) became `scrollIntoViewIfNeeded()` calls and explicit waits in the snippet bodies.
- **Idiom enforcement.** Where a hint flagged an unreliable primitive (e.g., `dragTo` for jQuery UI sortable), the driver locked in the hint's recommended alternative even when the easier primitive would have worked. Useful when the hint encodes real production pain; informative if your hint has a stale rule.

The hint set's job here isn't to fix things the driver got wrong (it didn't). It's to **encode coverage intent and project-specific gotchas** so the snippet library accumulates reusable building blocks rather than scenario-specific ones.

## What doc-grounded hints add on top (shop run-3 specifically)

Run-2 hints came from manually exploring the app for about an hour. Run-3 hints came from reading the app's [official documentation](https://testsmith-io.github.io/practice-software-testing/). The differences:

- **Framework identification was wrong in manual exploration.** Run-2's `driver.md` called the app "Vue 3 SPA." Run-3's, sourced from the docs, correctly identified it as Angular 20. The Angular identity directly explains the zone.js / dispatchEvent quirk that bit run-1 and run-2 — but only run-3 documented it as a known gotcha.
- **Documented async patterns came verbatim from the docs.** Run-3 captured search-box debounce (300ms), postcode lookup debounce (300ms with auto-fill of street + city), invoice PDF status polling (every 20s). Manual exploration would catch the search debounce by trying it; the others require reading docs.
- **Role differences and negative knowledge came from the docs.** "TOTP setup is denied for the test customer and admin accounts" — useful negative knowledge that prevents the agent from trying to enable TOTP and failing.

The cost-benefit: about an hour of reading docs + 15 minutes of transcription into `driver.md` produced a hint file that took spec-mode forge from "iterate three times to discover the Angular timing quirk" to "first-try pass." For any flow you intend to re-run many times, that's a substantial win.

## The load-bearing mechanism

**Selectors in `driver.md` shape the snippet library, and the snippet library shapes what specs can compose.**

Worked example using shop:

- Run-1's `driver.md`: doesn't exist. The driver navigates to a specific product URL during the drive (whatever the first hammer was that day). Snippet-author writes `add-product-to-cart` taking a `productUrl` argument. Spec-writer composes that snippet with the literal URL embedded.
- Run-2's `driver.md`: lists `a[data-test^="product-"]` as the product-card selector. Snippet-author writes `open-first-search-result` as a standalone snippet. Spec-writer composes `search → open-first → add` — never names a specific product. Spec is robust to inventory drift.

Same task. Same site. Same model driving. The structural difference comes from one line in the hint file. **That single hint changed the snippet shape, which changed the spec composition, which changed whether the spec is robust to a real-world condition.**

This is the mechanism most worth internalising when authoring your own hints: lead with a thorough selector inventory in `driver.md`. Spec-mode robustness follows from there.

## How to use these samples for your own hint authoring

1. **Pick the target closest to your app.** internet for low-complexity, widgets for legacy-widget-heavy, shop for modern SPAs with auth.
2. **Open `run-1/hints/` and `run-2/hints/` side by side.** The diff is what comprehensive hints add over bare-minimum.
3. **For the sharpest template, read `shop/run-3/hints/`.** Those are the cleanest hint files in the collection — derived from a documentation-grounded approach you can replicate on your own app.
4. **Author your own `forge/hints/{driver,forge}.md` in the same shape.** The smaller hint files (`snippet-author.md`, `spec-writer.md`, `spec-verifier.md`) are usually unnecessary; defaults cover them.

The hint-authoring guidance ships with `/forge init` at `forge/hints/README.md` — read that alongside these samples for the full reference.

## Cross-target patterns to notice

A few things hold across all three targets — worth seeing in the samples for yourself:

- **Snippet-author voluntarily decomposes along observation boundaries.** Even in run-1 with no hints, snippet-author split text-box into fill + read-output (rather than fusing them). The library is naturally compositional; hints amplify rather than originate this behaviour.
- **The driver respects the hint as authoritative.** When the hint says "use X primitive," the driver uses X — even if Y would have worked. This is useful when the hint encodes real production pain (your team has good reason to prefer one approach) and informative when it doesn't (audit your hints periodically for stale rules).
- **Spec naming and shape converge across runs.** All three shop runs produced `checkout-hammer-cash-on-delivery.spec.ts` (or near-equivalents). The hint set changes what's *inside* the spec, not its name or surface.
- **Snippet quality is consistent.** Every snippet across the collection has a `meta` block with description + typed args, exports a single `run(page, args)`, uses `page.locator()` not deprecated `$()`. The snippet-author follows a coherent house style without project hints needing to specify it.

## A complete tour, in order

If you want to read the samples linearly:

1. [`internet/`](./internet) — start here. Smallest output surface, clearest comparison of bare-driver vs hint-driven snippet shape.
2. [`widgets/`](./widgets) — middle complexity. See how snippet-author handles non-form widgets (calendar, drag-reorder, modals, autocomplete).
3. [`shop/`](./shop) — the most consequential. Read the three runs in order — `run-1` → `run-2` → `run-3` — to see the hint-quality progression on a real Angular checkout.
