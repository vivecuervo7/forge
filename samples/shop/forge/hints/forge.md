# Project hint: forge — practicesoftwaretesting.com

The single operate-the-app hint, read by the lead and the driver. It holds the
project's operate contract — env, accounts, setup, teardown — followed by how to
drive the app: structure, routes, selectors, login flow, and known gotchas.

Knowledge about practicesoftwaretesting.com, sourced from the [official docs](https://testsmith-io.github.io/practice-software-testing/).

## What this project is

The Practice Software Testing app — an Angular 20 + Laravel 12 e-commerce + tool-rental platform, deliberately built as a software-testing playground. The live demo at `https://practicesoftwaretesting.com` runs sprint 5 (the full-platform version). Sprint 1–4 plus a deliberate-bugs and a performance-degradation variant are hosted at `sprint{N}.practicesoftwaretesting.com` if a reduced or instrumented surface is useful.

## Authentication

Auth is JWT-based. The frontend logs in via `POST /auth/login`, stores the JWT in localStorage, and sends it as a Bearer token on subsequent requests. OAuth (Google/GitHub) is supported but isn't useful for automation — use email/password.

## Test accounts

Three accounts are seeded by the deployment. Each has a pair of env keys.

| Account | Role | Env keys |
|---|---|---|
| `customer`  | customer | `PST_CUSTOMER_EMAIL` / `PST_CUSTOMER_PASSWORD` |
| `customer2` | customer | `PST_CUSTOMER2_EMAIL` / `PST_CUSTOMER2_PASSWORD` |
| `admin`     | admin    | `PST_ADMIN_EMAIL` / `PST_ADMIN_PASSWORD` |

To load these env vars, prepend any command that needs them with:

```
set -a && source .env && set +a &&
```

Account-specific behaviour:

- TOTP setup is denied for `customer` and `admin`. Don't try to enable it.
- `admin` is exempt from the account-lockout policy.

## Adding another test account

The seeded set is fixed; the deployed demo doesn't expose a mint-on-demand endpoint. To use a fresh account:

1. Register via `/auth/register`. The password-strength meter requires `Strong` or higher — use 8+ chars with mixed case, digit, symbol.
2. Add a row to the table above with a chosen account keyword and a new pair of env keys (e.g. `PST_TESTER_EMAIL` / `PST_TESTER_PASSWORD`).
3. Set the values in your env layer.

The new account persists until the demo redeploys; for a long-lived rotation expect to re-register periodically.

## Setup before each run

No setup needed beyond the seeded accounts. The deployed demo has no public state-reset endpoint, so server-side state (placed orders, registered accounts, profile updates) accumulates across all users' interactions.

Practical implication: specs that mutate server-side state can't be reset between runs. **Design specs to tolerate state drift** — assert on shape rather than value (`/INV-\d+/` not `INV-2026000042`), search for products dynamically instead of hardcoding UUIDs, treat any cart contents as the starting point rather than expecting an empty cart.

## Teardown after each run

None required.

---

# Driving the app

The sections below are sourced from the official documentation at https://testsmith-io.github.io/practice-software-testing/. This is what "comprehensive hints, post-docs-review" looks like for this app.

## App overview

The Practice Software Testing app — a deliberately-realistic e-commerce + tool-rental platform built as a software-testing playground. Angular 20 + Bootstrap 5 frontend, Transloco for i18n, JWT-backed auth, Laravel 12 backend (we interact with it only through the API the frontend already calls).

The live demo at `https://practicesoftwaretesting.com` runs sprint 5 — the full-platform version with admin dashboard, 5 payment methods, OAuth, TOTP, and a chat widget. Older sprints are hosted at `sprint{1-4}.practicesoftwaretesting.com` if you need a reduced surface.

## Routes (clean URLs, no hash routing)

The frontend uses Angular's clean-URL routing with scroll restoration and full lazy-loading per module. Emit full URLs in snippets, not relative paths.

| Path | Module / Purpose |
|---|---|
| `/` | ProductsModule — paginated catalog with filter, search, sort, price slider |
| `/products/:id` | Product detail page |
| `/checkout` | CheckoutModule — multi-step flow (cart review → sign-in → address → payment → confirm) |
| `/auth/login` | Login |
| `/auth/register` | Self-service registration |
| `/auth/forgot-password` | Password reset |
| `/account` | Customer dashboard (profile, orders, favorites, messages) |
| `/admin` | AdminModule — admin-only dashboard, lazy-loaded |

## Selectors

The site uses `data-test` attributes throughout. Prefer them over CSS/text matchers.

### Authentication

- Email field: `input[data-test="email"]`
- Password field: `input[data-test="password"]`
- Login submit: `input[data-test="login-submit"]` (note: `input`, not `button`)
- Login error: `[data-test="login-error"]`
- Register submit: `input[data-test="register-submit"]`

### Catalog and search

- Search box: `input[data-test="search-query"]`
- Search submit: `button[data-test="search-submit"]`
- Product card link (listing): `a[data-test^="product-"]` (suffix is the product UUID)
- Add to cart (on product page): `button[data-test="add-to-cart"]`
- Cart icon (nav): `a[data-test="nav-cart"]`
- Cart quantity badge: `[data-test="cart-quantity"]`
- Cart success toast (after add): `[role="alert"]` with text matching `/Product added/i`

### Checkout

- Cart-review proceed: `[data-test="proceed-1"]`
- Sign-in proceed: `[data-test="proceed-2"]`
- Billing-address proceed: `[data-test="proceed-3"]`
- Payment finish (Angular zone.js quirk — see gotchas): `[data-test="finish"]`

Billing address fields:
- Country: `select[data-test="country"]`
- House number: `input[data-test="house_number"]`
- Postal code: `input[data-test="postal_code"]`
- State: `input[data-test="state"]`

Payment:
- Method dropdown: `select[data-test="payment-method"]`
- Option labels (verbatim): `'Bank Transfer'`, `'Credit Card'`, `'Buy Now Pay Later'`, `'Gift Card'`, `'Cash on Delivery'`

### Order confirmation

- Container: `#order-confirmation`
- Success text matches `/Thanks for your order!/`
- Invoice number matches `/INV-\d+/`

## Login flow

1. `goto https://practicesoftwaretesting.com/auth/login`
2. Fill `input[data-test="email"]` with the account's email
3. Fill `input[data-test="password"]` with the account's password
4. Click `input[data-test="login-submit"]`
5. URL changes to `/account` on success

If login fails, `[data-test="login-error"]` renders with the error text. The account's env keys are documented in the test-accounts table above.

## Known gotchas

- **Angular zone.js + buttons that need `dispatchEvent`.** Some Angular bindings (the checkout `finish` button most consistently) don't fire on a plain Playwright `.click()` because zone.js misses the synthetic event. Two patterns work: `getByRole('button', { name: '...' }).click()` dispatches in a way Angular picks up, or `locator(...).dispatchEvent('click')` forces the event explicitly. Prefer `getByRole` where it reads cleanly; fall back to `dispatchEvent` when the element doesn't have an accessible name.
- **Payment "Confirm" is a two-click flow.** First click processes payment and surfaces a `Payment was successful` message; second click finalises the order and reveals `#order-confirmation`. The success message appearing doesn't mean Angular has settled — `waitFor` on the success element is necessary but **not sufficient**. The second click (`dispatchEvent` on `[data-test="finish"]`) only lands after a settle beat: `waitFor` the success text → `waitFor` the finish button visible → a short `waitForTimeout` (~800–1000ms) for zone.js to wire the finish handler → `dispatchEvent('click')`. A cold headless run fires inside that settle window and the event is silently dropped (page freezes at "Payment was successful" with the Confirm button still active) unless the explicit beat is present. (Verified during a cold spec verify: `waitFor`-only flaked until the `waitForTimeout(1000)` beat was added.)
- **Search box debounces 300ms.** After typing into `input[data-test="search-query"]`, wait for the network request to settle before asserting against the result list.
- **Postcode lookup debounces 300ms.** On the checkout address step, populating country + postcode + house_number triggers an async lookup that auto-fills street and city. Either wait for the autofill before clicking `proceed-3`, or fill `street` and `city` explicitly to skip the dependency.
- **Password strength meter blocks register submit.** Registration requires the meter to read "Strong" or higher. Levels: Weak / Moderate / Strong / Very Strong / Excellent. Use 8+ chars with mixed upper/lower/digit/symbol.
- **Invoice PDF download is async.** After clicking download, the UI polls status every 20 seconds. Don't read the PDF immediately — wait for the download-status endpoint to report ready.
- **Demo product inventory rotates.** Product UUIDs in `/products/:id` are not stable across deployments. Always search by name and pick the first result; never hardcode `/products/<uuid>` in snippets or specs.
- **No public state-reset endpoint.** The deployed demo has whatever state the previous user left. Specs that mutate state (place orders, register users, update profiles) will see drift on re-runs. Design assertions to tolerate this — regex-match `/INV-\d+/` instead of asserting a specific invoice number, etc.
- **Cash on Delivery is the easiest payment method for specs.** No extra fields, no validation beyond the basic selection. Use it unless your test specifically targets one of the other methods.
- **The chat widget lives in the bottom-right corner.** It can occlude buttons on smaller viewports — if a click in that region misses, scroll or resize before retrying. The widget is opt-in; ignore it unless your test targets it.
- **Login form inputs require click-before-fill.** Angular's change detection on `input[data-test="email"]` and `input[data-test="password"]` doesn't fire if `fill()` is called without a preceding `click()` on the same element. The symptom is "Invalid email or password" even with correct credentials. Always call `.click()` then `.fill()` (or invoke the `login` snippet, which already encodes this).

## Feature surface (for choosing test data)

- **Roles**: `customer`, `admin`, `guest`. Guest can browse and check out without auth. Customer is the standard role for end-to-end shop flows. Admin has the admin dashboard and is exempt from the account-lockout policy.
- **Payment methods**: Bank Transfer, Credit Card (XXXX-XXXX-XXXX-XXXX number + MM/YYYY + CVV + cardholder), BNPL (3/6/9/12 month installments), Gift Card (16 alphanumeric chars + 4-char validation code), Cash on Delivery (no extra fields).
- **Discounts that may shift cart totals**: geo-location (5–25% based on city — New York 5%, Mumbai 10%, Tokyo 15%, Amsterdam 20%, London 25%) and combination (15% when cart has both rental and non-rental items). If your test cares about totals, hold these constant explicitly.
- **Validation limits** for form-fill snippets: email RFC + max 256 chars; postal code on registration is numeric only; phone is numeric only; street max 70; city/state/country max 40; checkout postal code max 10; contact form message min 50 chars; file attachment is `.txt` only and exactly 0 KB (deliberate edge case).
- **Order statuses** (admin): `AWAITING_FULFILLMENT`, `ON_HOLD`, `AWAITING_SHIPMENT`, `SHIPPED`, `COMPLETED`.
- **Languages**: DE, EN, ES, FR, NL, TR via Transloco. Default is EN; if your assertions match validation text, hold the locale steady.
- **TOTP / 2FA**: Setup is denied for both `customer` and `admin` test accounts. Don't try to enable it during a drive.
