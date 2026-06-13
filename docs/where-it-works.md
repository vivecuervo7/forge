# Where forge works (and where it doesn't)

A field report on forge v0.11.0's behaviour across three deliberately-different web targets, with and without project-knowledge hint files.

## The experiment

Three sandbox apps, each chosen to map a different surface:

| Target | Site | Why interesting |
|---|---|---|
| **internet** | [the-internet.herokuapp.com](https://the-internet.herokuapp.com) | Boundary probe. Each page isolates one classic-hard interaction: dialogs, drag-drop, shadow DOM, iframes, async loading. |
| **widgets** | [demoqa.com](https://demoqa.com) | Legacy-widget gauntlet. Kendo + jQuery UI + React date pickers + drag-reorder + tag input. Ads / banner clutter. |
| **shop** | [practicesoftwaretesting.com](https://practicesoftwaretesting.com) | Real-app middle ground. Vue 3 SPA, Angular checkout, auth required, real backend, real form validation. |

Each target was driven against twice:

- **Phase 1 — bare-minimum hints.** Either no hint file (internet, widgets) or only the auth env contract (shop). Driver discovers everything else from the site itself.
- **Phase 2 — comprehensive hints.** A rich `driver.md` (plus `forge.md` on shop) with probe/route map, selectors, known gotchas. Models what an adopter writes after spending an hour learning the app.

24 probes total: 5×2 on internet + 5×2 on widgets + 2 (drive + spec mode) × 2 on shop. ~4 hours of real driving and verification.

## Headline result

**Two distinct lifts from comprehensive hints, depending on the task shape:**

- **Drive-mode probes (20 across internet + widgets + shop scenario A):** library-shape lift, not pass-rate lift. Phase 1 already passed 20/20. Phase 2 produced more decomposed, more parameterised, more defensive snippets.
- **Spec-mode on a mutating SUT (shop scenario B):** **pass-rate lift.** Phase 1's spec verified once then broke on re-run because it hardcoded a depleted product URL. Phase 2's spec composes snippets that pick "first hammer in search results" dynamically — verifies-from-fresh in 17.7s and is stable across re-runs.

The hint set's leverage shows up specifically where (a) the task is multi-step enough to compose snippets, (b) the SUT mutates as a side effect, and (c) the spec must survive cold-start re-verification. For single-step drives, hints add polish; for compositional specs, they can rescue the artifact from one-shot brittleness.

## What the bare driver gets right

This is the surprising part of phase 1. Across every target, the driver:

- **Picks `data-test`/`#id` over text matchers** when the markup offers them.
- **Picks modern Playwright primitives** for hard widgets: `dragTo` for HTML5 DnD on the-internet, incremental mouse-move for jQuery UI sortable on demoqa, native `<select>` options for React date pickers, `page.once('dialog', d => d.accept())` ordered before the click for JS alerts. These are 2024-era idioms; the model has internalised them.
- **Pierces shadow DOM** without explicit descent — modern Playwright's `locator()` handles it; the driver knew not to over-engineer.
- **Discovers framework quirks experimentally.** The Angular zone.js / dispatchEvent gotcha on the shop's `finish` button was figured out by trying `.click()`, observing no state change, and pivoting to `dispatchEvent`. Root-cause analysis on a non-trivial framework issue, with no hint.
- **Splits drives into compositional snippets unprompted.** snippet-author voluntarily split text-box into fill + submit-and-capture, autocomplete into add + get-chips, payment into select + dispatch-and-confirm.

This is what the experiment actually showed in phase 1: a 2024-era model + modern Playwright + the team-coordination scaffold already covers the easy-to-mid drive-mode case.

## What phase 2 hints unlocked on shop scenario B

The most consequential single finding. Same task, same site, same flow:

**Phase 1 spec** (bare-minimum hints):
- Driver added a specific hammer to cart by navigating to `https://practicesoftwaretesting.com/product/01KTZBASJSPFXXAWRD3N6GZWDG`
- spec-writer embedded that URL literally in the spec
- First verification placed a real order; second verification failed because that product was depleted from the demo inventory
- Spec was *correct* but *not re-runnable*

**Phase 2 spec** (comprehensive `driver.md` listing `a[data-test^="product-"]` as the product-card selector):
- snippet-author authored `open-first-search-result` as a stand-alone snippet (the selector vocabulary made it the obvious factoring)
- spec-writer composed `searchForProduct({ query: 'hammer' }) → openFirstSearchResult() → addProductToCart()` — never names a specific product
- Verifier passed from cold start in 17.7s
- Spec is re-runnable indefinitely because it picks whatever the first hammer is now

**The fix wasn't smarter setup/teardown — it was that the hint's selector vocabulary led the snippet-author to author a generic snippet, which made the spec naturally robust.** This is a non-obvious mechanism: hints work by shaping the library, and the library shape shapes the spec.

## The spec-mode iteration loop

Scenario B on shop is the most demanding test: full Angular multi-step checkout, 4-agent team (driver + snippet-author + spec-writer + spec-verifier), cold-start verification mandatory.

The verifier-led iteration loop caught real bugs across both phases:

- **Phase 1 (4 iterations to escalation):** missing cart-success-toast wait → patched. Missing Angular zone.js settle delay → patched. Then hit the stock issue and escalated.
- **Phase 2 (3 iterations to pass):** missing wait between Confirm clicks (the same zone.js issue, fixed once) → patched in one round. Spec passes.

In both cases the agent team self-corrected without human intervention. The lifecycle works as designed. The cost: phase 2 was ~14 min total wall-clock (vs phase 1's ~35 min). The improvement came from hints making the iteration converge faster.

For real adoption: spec mode is best invested in flows you'll re-run many times (canonical happy-path repros, CI smoke tests). For one-shot debugging or quick exploration, drive mode (~2-3 min per probe) is the right tool.

## Inter-agent ping reliability

A real bug, reproducing on every run across all three targets: **`snippet-author` reliably wrote snippets, marked tasks complete, and went idle without sending the `task <id> complete` SendMessage to `team-lead`**. The team would stall waiting for a ping that never arrived.

Workaround used during the experiment: explicit "you MUST SendMessage team-lead with completion summary BEFORE going idle" in the spawn prompt. This mostly fixed it but didn't 100% — at least one team needed force-cleanup.

Fix candidates:
- Strengthen the snippet-author SKILL.md to mandate the completion ping rather than mention it.
- Have team-task.md's team-lead phase 4 use a different signal (task status check) instead of relying on the ping.
- Auto-nudge from team-lead if both tasks are `completed` but no pings have arrived after N seconds.

This is worth fixing before publishing the plugin to a wider audience — it makes the lifecycle look broken to a fresh user who doesn't know to add the "you MUST" clause.

## Bug: chromium leak on slot release

Reproducing 24/24 across all three targets. `forge-pool-release.sh` releases the slot's `state.json` lock but doesn't close the slot's playwright-cli session or its chromium processes. After each probe:

- the slot's playwright-cli session (`ft-<hash>`) remained in `status: open`
- ~8 chromium processes orphaned in the OS

Workaround used: manual `playwright-cli -s=<session-name> close` after each `forge-pool-release.sh`. Restored chromium count to baseline every time.

Fix: either `forge-pool-release.sh` should call `playwright-cli -s=$(jq -r .playwrightSessionName $SLOT_DIR/state.json) close` before releasing the lock, or the team-lead's phase-5 cleanup should do it explicitly. Worth fixing before publication — accumulating leaks across a session is the kind of "feels broken" experience that loses early adopters.

## Cross-target headline patterns

- **Drive mode + bare driver covers most of the surface.** 20/20 drive-mode probes passed without hints. That bound holds for public-facing widget pages and simple form flows.
- **Spec mode + bare driver works once, then bites you.** The shop phase-1 spec was correct but not re-runnable because the driver naturally hardcoded the product it happened to be looking at. Without a hint guiding compositional snippet shape, the spec inherits the drive's specificity.
- **Comprehensive hints earn their keep specifically in the spec-on-mutating-SUT case.** Outside that case, they're library polish — real value but not a binary "works/doesn't" lift.
- **The leverage isn't through `forge.md` setup/teardown.** Across all three targets, the project authors did NOT write the kinds of setup steps that would actually have rescued phase 1. What rescued phase 2 was selector-vocabulary-driven compositionality. This is a real, transferable lesson: **invest hint effort in selectors and known gotchas, not in trying to script around SUT state**.

## When to use forge

Strong fit:
- Driving a one-shot bug repro on a known-clean SUT and capturing it as a runnable artifact.
- Building a library of reusable interaction steps for a new product without writing them by hand.
- **Producing re-runnable specs against a mutating real backend** — provided the hint set encodes enough selector vocabulary that the snippet-author authors composable, generic snippets rather than literal-URL-bound ones.
- Verifying a fix against a real browser + real backend, with paired before/after evidence.
- Multi-agent collaborative drilling on a hard interaction (the spec-mode iteration loop on the shop's Angular checkout is a good example — humans wouldn't catch the zone.js dispatchEvent timing faster).

Less good fit:
- Anything where the team's iteration cost (~14-35 min for spec-mode) outweighs the fidelity benefit (millisecond-deterministic CI specs, for instance).
- Investigating broad surface area without any flow in mind — drive mode is naturally per-task, not per-discovery.
- Working without compositional hint vocabulary on a destructive flow. You'll get phase-1-shop's "spec works once, breaks forever" pattern.

## What we'd change before publishing 0.11.0

1. **Fix the chromium leak.** Either in `forge-pool-release.sh` or in the team-task lifecycle phase-5 cleanup. Concrete, reproducible, has a known workaround.
2. **Fix the snippet-author ping reliability.** Stronger SKILL.md directive, or move the team's completion signal off the ping.
3. **Document the "selector vocabulary → compositional snippet → re-runnable spec" mechanism prominently** — preferably with a worked example of the shop comparison. This is the place where hints earn their keep, and currently the docs don't make that clear.

After those three, this is a real, usable plugin for the cases it advertises.
