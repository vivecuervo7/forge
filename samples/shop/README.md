# shop — exemplar for auth-bearing apps with multi-account scenarios

This sample is a project shaped like one that's had `/forge init` run on it — a `forge/` subdir with the hints, a config, and (once you run forge against it) snippets and specs. The target is [practicesoftwaretesting.com](https://practicesoftwaretesting.com) — Angular 20 + Bootstrap 5 e-commerce + tool-rental platform, JWT-based auth, `data-test` attributes throughout, multi-step checkout.

**If your project has authentication, multiple test accounts, or both, mirror this sample.**

## What's here

| File | Purpose |
|---|---|
| [`forge/hints/forge.md`](./forge/hints/forge.md) | The auth + multi-account hint. A three-row account table maps account keywords (`customer`, `customer2`, `admin`) to env-key pairs. **The shape to copy when documenting your project's accounts.** |
| [`forge/hints/driver.md`](./forge/hints/driver.md) | A doc-grounded selector inventory + known-gotchas list, sourced from the app's [official docs](https://testsmith-io.github.io/practice-software-testing/). Includes the Angular zone.js `dispatchEvent` quirk, the search-box debounce, the two-click payment flow — project-specific knowledge that turns iterate-to-discover into first-try-pass. |
| [`.env.example`](./.env.example) | The env keys the account table references, with the seeded demo credentials filled in. Copy to `.env` and either uncomment the dotenv import in `forge/playwright.config.ts` or load the same keys via direnv / dotenv-cli / your shell. |
| `forge/playwright.config.ts` | Scaffolded by `/forge init`. Fallback Playwright config for forge specs. |
| `forge/snippets/search-for-product.ts` | **Seeded** — produced by a real forge run against this hint set. Submits a search and waits for the result list. |
| `forge/snippets/open-first-search-result.ts` | **Seeded** — clicks the first product card on the current page. |
| `forge/snippets/add-product-to-cart.ts` | **Seeded** — adds the currently-displayed product to the cart. |
| `forge/hints/snippet-author.md` | **Proposed** during the same seed run — `forge:snippet-author` noticed both search snippets above used the same precondition pattern (page URL doesn't change after Angular renders search results) and proposed lifting that into a hint. A worked example of the proposal mechanism; see the top-level README's "Hints grow during use" section. |

The seeded snippets and the proposed hint give the walkthrough below a starting library to reuse against. They're authentic forge output, not hand-edited.

## Walkthrough — see forge work, prompt by prompt

Run these in order from inside `samples/shop/` (the project root, parent of `forge/`). Each prompt builds on the state of the previous.

Before you start: `cp .env.example .env`. The hint instructs the driver to load env per command, so you don't need to source anything yourself.

### 1. Library reuse — the existing snippets carry a fresh task

```
/forge add the first claw hammer to the cart
```

The driver scans `forge/snippets/`, recognises that all three seeded snippets cover the steps it needs, and invokes them in sequence. No new snippets are authored.

**What to look for:**
- Driver narrates three "invoked …" steps to snippet-author.
- `forge/snippets/` is unchanged after the run.
- Total time around 30–60 seconds.

**What this demonstrates:** an existing library carries a fresh task end-to-end. The "claw hammer" specifics differ from whatever the seeded snippets were originally driven against, but the snippets are parameterised on `query` and don't care which hammer — that's the value of authoring along the hint's selector boundaries.

### 2. Reuse + new authoring — the library grows where it needs to

```
/forge log in as customer, then add the first hammer to the cart
```

Now the task includes a step the seeded library doesn't cover (login). The driver invokes the three seeded snippets for the cart steps, and snippet-author authors a new snippet for the login step.

**What to look for:**
- A new `forge/snippets/login.ts` (or similarly-named) appears.
- The login snippet takes `email` and `password` as args — credentials reach it via shell expansion from `$PST_CUSTOMER_EMAIL` / `$PST_CUSTOMER_PASSWORD`.
- The three seeded snippets are invoked, not re-authored.

**What this demonstrates:** the library grows compositionally. Driver and snippet-author treat the existing library as the source of truth for what's already covered and only write what's genuinely new.

### 3. Spec mode end-to-end — the full pipeline produces a CI-ready artifact

```
/forge spec checkout a hammer with cash on delivery
```

Same surface as before, but spec mode adds `forge:spec-writer` and `forge:spec-verifier` to the team. The driver runs the full checkout, snippet-author authors the new checkout-step snippets that didn't exist yet (billing address, payment, confirmation), spec-writer composes a self-contained `.spec.ts` that imports and calls those snippets, and spec-verifier runs the spec cold from a fresh browser context.

**What to look for:**
- New checkout-related snippets in `forge/snippets/`.
- A `forge/specs/checkout-hammer-cash-on-delivery.spec.ts` (or similarly-named) lands.
- Spec-verifier runs the spec. It may pass first-try, or it may iterate — that's normal. When a snippet's behaviour during the live drive diverges from cold-start behaviour (timing, ordering, hidden form state), the verifier surfaces the failure, asks driver/snippet-author for clarification, applies a patch, and re-runs. Up to 3 iterations before it escalates to the team-lead with the unresolved failure.

**What this demonstrates:** the full pipeline produces a CI-ready artifact *that has been verified to work from cold*. The verifier's iteration loop is part of the value — it surfaces snippet bugs and SUT quirks that the live drive happened to dodge. Re-running the spec downstream is a single `npx playwright test` against your own project's runner; nothing forge-specific at run time.

### 4. Parallel runs — two accounts, two browsers, side by side

This step demonstrates the property that makes forge usable for real-world team testing: **multiple concurrent runs against different accounts, with zero forge configuration beyond declaring the accounts in `hints/forge.md`**.

Open a *second* terminal and start another claude session in this directory:

```bash
cd /Users/isaac/repos/forge/samples/shop
claude --plugin-dir /Users/isaac/repos/forge
```

You now have two independent claude sessions — call them **Session A** and **Session B** — both bound to the same `samples/shop/` project. In **Session A**, type:

```
/forge log in as customer and add the first hammer to the cart
```

Immediately switch to **Session B** and type:

```
/forge log in as customer2 and add the first hammer to the cart
```

**What to look for:**

- Two chromium windows open side by side, navigating independently. Each shows a different account's login flow.
- Each driver's Bash commands reference its own account's env keys — `$PST_CUSTOMER_EMAIL` in Session A, `$PST_CUSTOMER2_EMAIL` in Session B — via the same shell-expansion + `forge-pw` redaction pattern from step 2.
- Both runs complete cleanly without interfering. Two playwright-cli sessions (different `ft-<id>` names), two ephemeral chromium profiles, two forge agent teams.
- The same `login.ts` snippet is invoked by both — once with customer's credentials, once with customer2's. The snippet is account-agnostic; the caller chooses.

**What this demonstrates:** parallel multi-account testing requires no special configuration. The mechanism is structural:

- `hints/forge.md` declares all accounts and their env keys (one place).
- The driver reads the account name from the user's task and looks up the matching env keys per invocation.
- The login snippet takes `email` + `password` as args — no account knowledge baked in.
- Each `/forge` invocation gets its own ephemeral chromium session, agent team, and tmux namespace.

This is the property that lets a team run concurrent test flows against different test accounts. Two flows, two accounts, completely isolated.

**Why this matters in real-world testing.** Many production apps enforce single-session-per-user (login from a second browser kicks out the first), or have shared per-account state (cart, order history, profile mutations) that makes two concurrent same-account runs collide. We don't claim to know whether practicesoftwaretesting.com behaves that way — the demo here is the pattern, not a specific constraint claim. But for the kinds of apps where it *does* apply (and that includes most stateful business apps), forge's mechanism is what lets you scale parallel testing without contention: a different account per concurrent run, declared in the hint table, picked up by the driver via shell expansion. The shop sample is the worked example you'd transplant.

### 5. Teach mode — when the agent can't be expected to discover the quirks

```
/forge teach login
```

Teach mode pilots forge step-by-step through a flow you want to capture deliberately. You drive the conversation; the driver executes one action at a time; snippet-author waits for explicit `cap as <name>` signals before writing.

Useful when:
- Login has fallback paths (auto-login short-circuit, retry on submit hang)
- A UI has conditional branches the agent can't be expected to predict
- You want gotcha annotations woven into the snippet body, not just discovered from a successful drive

The seeded login from step 2 was authored opportunistically by snippet-author. Teach mode is the channel for the deliberately-curated version — same login flow, but with the user signalling "wait for auto-login redirect" and "retry on submit hang" as part of the body. Try it on a flow your team has wrestled with.

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

This scales naturally to N accounts. Add a row to the table; add a pair of env keys; the driver picks the right pair when the user names that account.

## How to read this sample for your own project

1. **Start with `forge/hints/forge.md`.** Copy the account-table structure and adapt the rows to your project's test accounts. Keep the env-key column — it's the bridge between user-facing keywords and `process.env` names.

2. **Read `forge/hints/driver.md`.** Your `driver.md` should have the same shape: app overview, routes table, selector inventory grouped by element class, login flow, known gotchas. The doc-grounded approach (read your app's docs, transcribe into `driver.md`) is the highest-leverage hint-authoring investment.

3. **Copy `.env.example` to `.env`** (or use direnv / dotenv-cli / your shell). Forge takes no opinion on how values reach `process.env`, only that they're there when the driver runs.

4. **Run forge against your target.** Drive a few tasks. Watch the library accrete. Try spec mode on the flow that matters most for CI. Try teach mode for the flows with quirks the agent shouldn't be expected to discover.

## Why this hint shape — findings from earlier runs

Earlier forge runs against this target (during design-phase field tests) gave us evidence for several choices the hints encode:

- **Documented vs experimentally-discovered quirks.** The bare driver discovered the Angular zone.js / `dispatchEvent` quirk on the checkout finish button by trying `.click()`, observing no state change, and pivoting. It got there — but only after experimental discovery, and only sometimes within a verifier-iteration budget. Documenting the quirk in `driver.md` up-front means future drives bake the workaround in from the first action; spec-mode verification passes first try (observed: 22.5s cold-start verification, zero verifier iterations) instead of iterating through several rounds.

- **Selectors-shape-snippets-shape-specs.** Without `a[data-test^="product-"]` documented as the product-card selector, a drive against "add a hammer to the cart" produces a snippet scoped to a specific product UUID and a spec that hardcodes whatever hammer UUID was on the page that day — re-runs break when that product gets depleted from the demo inventory. With the selector documented, snippet-author writes `open-first-search-result` as a standalone snippet, and the spec composes `search → open-first → add`. The hint's selector vocabulary directly shapes spec robustness against the live demo's mutating state.

- **Doc-grounded vs exploration-grounded hints.** This `driver.md` was written from the app's [official documentation](https://testsmith-io.github.io/practice-software-testing/), not from manual clicking. The docs catch things exploration misses: framework identity (Angular 20, not Vue 3 as exploration assumed), documented async patterns (search box 300ms debounce, postcode lookup 300ms with auto-fill of street + city), explicit role differences ("TOTP setup denied for customer and admin"). About an hour of reading docs produced a hint file that turns spec-mode forge from iterate-to-discover into first-try-pass.

- **Multi-account-from-the-start.** Two-customer scaffolding (`customer` + `customer2`) lets two forge sessions run in parallel without cart/order collision on the live demo. The account table makes the parallel-run constraint explicit; the hint warns that a third concurrent run against the same role will collide on backend state.
