# shop / run-3 — doc-grounded comprehensive hints

**Hint set in place:** same shape as run-2 — full `forge.md` + comprehensive `driver.md` — but rewritten end-to-end from the app's [official documentation](https://testsmith-io.github.io/practice-software-testing/) rather than manual exploration.

Reading the docs gave us things that exploration hadn't:

- Framework identification: **Angular 20 + Bootstrap 5** (manual exploration had assumed "Vue 3 SPA" — the corrected framework identity explains the zone.js / dispatchEvent quirk that bit run-1 and run-2)
- The full route map by Angular module (`ProductsModule`, `CheckoutModule`, `AuthModule`, `AccountModule`, `AdminModule`)
- Documented async patterns: search box debounces 300ms, postcode lookup debounces 300ms and auto-fills street + city, invoice PDF download polls status every 20 seconds
- Validation rules: postal code numeric only on registration, phone numeric only, street ≤70 chars, message ≥50 chars
- Role differences: TOTP setup denied for the test customer + admin accounts; admin is exempt from account-lockout
- Explicit statement that there's no public state-reset endpoint, so specs must tolerate state drift

Working tree wiped before this run; same scenarios as run-1 and run-2.

## Results

### Scenario A — drive mode

Drive completed cleanly. Same three snippets as run-2 (the hints already supplied the right selectors, so the snippet shape didn't change for this simple drive).

### Scenario B — spec mode

This is the run-3 punchline. **The spec verified from a cold start on the first try, in 22.5 seconds, with zero verifier iterations.**

Six total snippets (three from Scenario A's library + three new for the checkout phases). The composed spec searches dynamically (same as run-2) and survives inventory rotation. The Angular zone.js / dispatchEvent + two-click + wait-between-clicks pattern was baked into the very first drive because the hint documented the quirk up front — no experimental discovery needed during the drive, no verifier iterations needed to patch a missing wait.

## What this tells you

Run-1, run-2, and run-3 produced increasingly clean specs for the same task:

| | run-1 | run-2 | run-3 |
|---|---|---|---|
| Hint approach | minimal (auth only) | hand-written from exploration | rewritten from official docs |
| Spec inventory dependency | hardcoded product URL | dynamic search-then-pick | dynamic search-then-pick |
| Framework quirk handling | discovered experimentally during drive | discovered during verifier iteration | baked into first drive from hint |
| Verifier iterations to pass | several | a few | **zero** |

The takeaway: **doc-grounded hints take spec-mode forge from "iterate to discover quirks" to "first-try pass."**

When you onboard forge to an app you maintain, the cost of writing comprehensive hints is roughly:

- 30–60 minutes to read your app's own docs (architecture page, API docs, any internal "how the frontend works" doc your team maintains)
- 15 minutes to transcribe the relevant bits into `forge/hints/driver.md` — framework identification, route map, canonical selectors per element class, documented async patterns, known quirks
- Optional: 15 more minutes filling in `forge/hints/forge.md` with the auth env contract and any setup/teardown steps your app needs

That one-hour upfront investment is the difference between iterate-to-discover specs and first-try-pass specs across every future drive.

## Why this is the publishable example

The shop run-3 hint files are the cleanest template in this collection. If you want a starting point for your own `driver.md`, `hints/driver.md` here is the shape to copy:

- "What this project is" — one paragraph, framework + stack + role of the app
- "Routes" — table of paths to module/purpose
- "Selectors" — grouped by element class (auth, catalog, checkout, etc.), one canonical selector per class
- "Login flow" — explicit step-by-step if your app has auth
- "Known gotchas" — bullet list of framework quirks, debounces, async patterns
- "Feature surface" — payment methods, validation rules, role differences, anything else that affects test data design

Replace the practicesoftwaretesting-specific content with your app's, and you have a working hint file.

## Artifacts

- `hints/forge.md` + `hints/driver.md` — the doc-grounded hint set (the cleanest template in this collection)
- `snippets/` — 6 snippets (3 from Scenario A + 3 new for checkout)
- `specs/checkout-hammer-cash-on-delivery.spec.ts` — the verified spec
