# shop — exemplar for auth-bearing apps with multi-account scenarios

This sample is a `forge/`-shaped directory showing what a polished setup looks like for an app with login, multiple test accounts, and multi-step transactional flows. The target is [practicesoftwaretesting.com](https://practicesoftwaretesting.com) — Angular 20 + Bootstrap 5 e-commerce + tool-rental platform, JWT-based auth, `data-test` attributes throughout, multi-step checkout.

**If your project has authentication, multiple test accounts, or both, mirror this sample.**

## What's here

| File | Purpose |
|---|---|
| [`hints/forge.md`](./hints/forge.md) | The auth + multi-account hint. A three-row account table maps account keywords (`customer`, `customer2`, `admin`) to env-key pairs, documents where values live (direnv / `.env` / shell exports / secrets manager), and shows the driver's shell-expansion invocation pattern. **The shape to copy when documenting your project's accounts.** |
| [`hints/driver.md`](./hints/driver.md) | A doc-grounded selector inventory + known-gotchas list, sourced from the app's [official documentation](https://testsmith-io.github.io/practice-software-testing/). Includes the Angular zone.js `dispatchEvent` quirk, the search-box debounce, the two-click payment flow — project-specific knowledge that turns iterate-to-discover into first-try-pass. |
| [`.env.example`](./.env.example) | Copy-paste-ready template showing the env keys the account table references. Copy to `.env` and uncomment the dotenv import in `playwright.config.ts` to wire it up — or set the same keys via direnv / shell exports / your secrets manager. |
| `playwright.config.ts` | Scaffolded by `/forge init`. Fallback Playwright config for forge specs; has a commented-out dotenv-loading line for projects that want forge to load `.env` on each spec run. |
| `.gitignore` | Scaffolded by `/forge init`. Self-documenting; only `hints/` and tracked-by-default files persist in version control. |

## What's not here yet

The `snippets/` and `specs/` directories will be populated when you run forge against this target. Both are gitignored — the value of seeing them is them being real forge output, not hand-edited approximations.

To generate them yourself:

```
cd samples/shop
/forge add a hammer to the cart                  # drive mode → snippets/
/forge spec checkout a hammer with cash on delivery   # spec mode → snippets/ + specs/
```

After running, the directory will contain a snippet library shaped by the hint set, and (for spec mode) a verified `.spec.ts` composed from those snippets.

## The auth pattern, in one diagram

```
User says: "drive forge as customer to checkout a hammer"

  ┌─ hints/forge.md ─────────────────────────────────────────┐
  │ account `customer` maps to:                              │
  │   PST_CUSTOMER_EMAIL / PST_CUSTOMER_PASSWORD             │
  └──────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─ driver agent ──────────────────────────────────────────┐
  │ Bash command (recorded in tool-call transcript):        │
  │   --args "{\"email\":\"$PST_CUSTOMER_EMAIL\", ...}"     │
  │                                                         │
  │ Shell expands $PST_CUSTOMER_EMAIL at exec time.         │
  │ The literal value never enters the transcript.          │
  └─────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─ login snippet ─────────────────────────────────────────┐
  │ Receives email and password as args.                    │
  │ Never reads process.env. Never logs the values.         │
  └─────────────────────────────────────────────────────────┘
```

This scales naturally to N accounts. Add a row to the table; add a pair of env keys; the driver picks the right pair when the user names that account. **Forge has no concept of accounts itself** — the convention lives in the hint file, and forge follows what it says.

## How to read this sample for your own project

1. **Start with `hints/forge.md`.** Copy the account-table structure verbatim and adapt the rows to your project's test accounts. Keep the env-key column — it's the bridge between user-facing keywords and `process.env` names.

2. **Read `hints/driver.md` for the selector/gotcha pattern.** Your `driver.md` should have the same shape: app overview, routes table, selector inventory grouped by element class, login flow, known gotchas. The doc-grounded approach (read your app's docs, transcribe into `driver.md`) is the highest-leverage hint-authoring investment.

3. **Copy `.env.example` to `.env`** (or use direnv / dotenv-cli / your shell) — forge takes no opinion on how values reach `process.env`, only that they're there when the driver runs.

4. **Run forge** against your target. The artifacts that land in `snippets/` and `specs/` should resemble what the same hint shape produces here.

## Why this hint shape — findings from earlier runs

Earlier forge runs against this target (during design-phase field tests) gave us evidence for several choices the hints encode:

- **Documented vs experimentally-discovered quirks.** The bare driver discovered the Angular zone.js / `dispatchEvent` quirk on the checkout finish button by trying `.click()`, observing no state change, and pivoting. It got there — but only after experimental discovery, and only sometimes within a verifier-iteration budget. Documenting the quirk in `driver.md` up-front means future drives bake the workaround in from the first action; spec-mode verification passes first try (observed: 22.5s cold-start verification, zero verifier iterations) instead of iterating through several rounds.

- **Selectors-shape-snippets-shape-specs.** Without `a[data-test^="product-"]` documented as the product-card selector, a drive against "add a hammer to the cart" produces a snippet scoped to a specific product UUID and a spec that hardcodes whatever hammer UUID was on the page that day — re-runs break when that product gets depleted from the demo inventory. With the selector documented, snippet-author writes `open-first-search-result` as a standalone snippet, and the spec composes `search → open-first → add`. The hint's selector vocabulary directly shapes spec robustness against the live demo's mutating state.

- **Doc-grounded vs exploration-grounded hints.** This `driver.md` was written from the app's [official documentation](https://testsmith-io.github.io/practice-software-testing/), not from manual clicking. The docs catch things exploration misses: framework identity (Angular 20, not Vue 3 as exploration assumed), documented async patterns (search box 300ms debounce, postcode lookup 300ms with auto-fill of street + city), explicit role differences ("TOTP setup denied for customer and admin"). About an hour of reading docs produced a hint file that turns spec-mode forge from iterate-to-discover into first-try-pass.

- **Multi-account-from-the-start.** Two-customer scaffolding (`customer` + `customer2`) lets two forge sessions run in parallel without cart/order collision on the live demo. The account table makes the parallel-run constraint explicit; the hint warns that a third concurrent run against the same role will collide on backend state.
