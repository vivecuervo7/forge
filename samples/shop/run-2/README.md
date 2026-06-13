# shop / run-2 — comprehensive hints from manual exploration

**Hint set in place:** full `forge.md` (auth env, test accounts, default-scrub-suffices note) + comprehensive `driver.md` covering the SPA shape, route map, `data-test` selector inventory with 7 key selectors, login flow, and known gotchas (Pinia async updates, search debounce, password-strength gate). Written after about an hour of manually clicking through the app.

Working tree wiped before this run so the comparison with `run-1/` is apples-to-apples — same scenarios, fresh library.

## Results

### Scenario A — drive mode

Drive completed cleanly. **Three snippets this time, not two**:

| Snippet | What it does | Δ vs run-1 |
|---|---|---|
| `search-for-product.ts` | Navigate home, fill search box, submit. | Renamed from `search-products` for narrower naming. |
| `open-first-search-result.ts` | Click the first `a[data-test^="product-"]` on the current page. | **New, doesn't exist in run-1.** The hint's selector inventory listed `a[data-test^="product-"]` as the product-card selector, which made this a natural standalone snippet. |
| `add-product-to-cart.ts` | Click add-to-cart on the current product page, wait for the success toast. | No `productUrl` arg this time — the snippet assumes you're already on a product page (because `open-first-search-result` got you there). |

The decomposition matters for what scenario B can do.

### Scenario B — spec mode

The composed spec is `complete-hammer-checkout.spec.ts`. It composes the three Scenario A snippets — **so it never names a specific product**. It searches dynamically and picks whatever the first hammer is right now. The spec is stable against product rotation.

Three additional checkout-flow snippets authored: `checkout-login`, `checkout-fill-address`, `checkout-select-payment-and-confirm`. The payment snippet bakes in the two-click Confirm flow + wait between clicks that the driver discovered.

## What this tells you

Compare run-1's spec with run-2's:

| | run-1 | run-2 |
|---|---|---|
| First step | `goto <hardcoded product URL>` | `searchForProduct({ query: 'hammer' })` then `openFirstSearchResult()` |
| Re-runnable against rotating inventory? | No — the specific product may be gone | Yes — picks whatever the first hammer is now |
| Re-runnable across deployments? | Risky — UUID-based URLs are unstable | Yes — selectors are |

Same task. Same site. Same model driving. The structural difference comes from the hint's selector inventory — specifically the line `Product card link (listing): a[data-test^="product-"]`. That single hint changed the snippet shape, which changed the spec composition, which changed whether the spec is robust to a real-world condition (inventory drift).

This is the mechanism most worth internalising when authoring your own hints: **selectors in `driver.md` shape the snippet library, and the snippet library shapes what specs can compose.**

## Artifacts

- `hints/forge.md` + `hints/driver.md` — comprehensive hint set authored from manual exploration
- `snippets/` — 6 snippets (3 from Scenario A + 3 new from Scenario B)
- `specs/complete-hammer-checkout.spec.ts` — composes scenario A's snippets, inlines remaining checkout steps
