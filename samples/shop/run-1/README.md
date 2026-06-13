# shop / run-1 — bare-minimum hints

**Hint set in place:** `forge.md` covers the env contract (`PST_EMAIL` / `PST_PASSWORD`) and the public test accounts. No `driver.md`. The driver discovers routes, selectors, the multi-step checkout shape, and the Angular zone.js dispatchEvent quirk on its own.

## Scenarios driven

- **Scenario A** (drive mode) — `open the home page, search for "hammer", add the first result to the cart, confirm the cart badge incremented`
- **Scenario B** (spec mode) — `complete a checkout as customer — buy any hammer, accept the auto-populated address, pay with the default payment method, finish on the order confirmation`

## Results

### Scenario A

Drive completed cleanly. Two snippets:

| Snippet | What it does |
|---|---|
| `search-products.ts` | Navigate to home page, fill search box, submit. |
| `add-product-to-cart.ts` | Navigate to a product URL, click add-to-cart, wait for the success toast. |

### Scenario B

Drive completed cleanly. Four new snippets + one patched snippet from Scenario A. The composed spec asserts on the order-confirmation invoice format (`/INV-\d+/`).

| New snippet | What it does |
|---|---|
| `navigate-to-checkout.ts` | `goto /checkout`, click `proceed-1` to reach the sign-in step. |
| `checkout-sign-in.ts` | Fill `PST_EMAIL` / `PST_PASSWORD`, click login-submit, click `proceed-2`. |
| `checkout-billing-address.ts` | Fill country/state/postal-code/house-number, click `proceed-3`. |
| `checkout-payment-and-confirm.ts` | Select payment method, perform the two-click `finish` flow (the Angular zone.js workaround the driver discovered experimentally), wait for `#order-confirmation`, return invoice number. |

The patched snippet: `add-product-to-cart` gained a `waitFor` on the cart success toast after the driver discovered the cart API call wasn't always complete by the time the spec moved on.

The driver also discovered, experimentally, that the checkout `finish` button needs `dispatchEvent('click')` instead of standard `.click()` because Angular's zone.js misses the synthetic event, and that the flow needs two clicks (first triggers payment success, second creates the order). All of this is documented in the spec inline.

## What this tells you

Two interesting properties of bare-driver-mode output on a real Angular app:

1. **The driver discovers framework quirks experimentally.** No hint told it about the zone.js dispatchEvent issue; it tried `.click()`, observed no state change, and pivoted to `dispatchEvent`. This works — and produces correct code — but takes iteration time. Hints that document framework quirks up front (see `run-3/`) avoid this discovery cost.
2. **The drive's specificity leaks into the spec.** The drive navigated to a specific product URL (whatever the first hammer was that day). The spec embeds that URL literally — so if the product is no longer there on a future run, the spec breaks. This isn't a forge bug; it's an artifact of *what the driver actually did*. Comprehensive hints with selector vocabulary (see `run-2/` and `run-3/`) lead snippet-author to author `open-first-search-result` as its own snippet, which lets the spec compose `search → open-first → add` and survive inventory drift.

## Artifacts

- `hints/forge.md` — the minimal hint that was in place (auth env + test accounts only)
- `snippets/` — 6 snippets (2 from Scenario A + 4 new + 1 patched from Scenario B)
- `specs/checkout-hammer-cash-on-delivery.spec.ts` — the composed spec; correct code, but embeds a specific product URL
