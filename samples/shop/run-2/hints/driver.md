# Project hint: forge:driver

Consumed by `forge:driver` when driving against practicesoftwaretesting.com.

## What this project is

A Vue 3 SPA demo shop with paginated product catalog, search, faceted filters (category, brand, price slider), real form validation including a password-strength meter, multi-step checkout, and a customer dashboard. Real-app shape, modern locators.

## Routes

Origin: `https://practicesoftwaretesting.com`.

| Path | Description |
|---|---|
| `/` | Home — paginated product grid + filters |
| `/category/<slug>` | Category page (hand-tools, power-tools, etc.) |
| `/product/<slug>` | Product detail |
| `/checkout` | Multi-step checkout (sign-in → address → payment → confirm) |
| `/auth/login` | Login page |
| `/auth/register` | Self-service registration |
| `/account` | Customer dashboard (orders, profile) |

The full happy path: `/` → click product → product page → Add to Cart → cart icon top-right → `/checkout` → sign in → address (auto-populated for demo customers) → payment → confirm.

**Emit full URLs in snippet code.** `https://practicesoftwaretesting.com/auth/login`, not `/auth/login`.

## Selectors

The site uses `data-test` attributes throughout — prefer them over CSS or text matchers.

- Email field: `input[data-test="email"]`
- Password field: `input[data-test="password"]`
- Submit login: `input[data-test="login-submit"]` (note: `input`, not `button`)
- Add-to-cart on product page: `button[data-test="add-to-cart"]`
- Cart icon: `a[data-test="nav-cart"]`
- Quantity badge on cart icon: `[data-test="cart-quantity"]`
- Product card link: `a[data-test^="product-"]` (suffix is product UUID)

## Login flow

1. `goto https://practicesoftwaretesting.com/auth/login`
2. `fill input[data-test="email"]` with `process.env.PST_EMAIL`
3. `fill input[data-test="password"]` with `process.env.PST_PASSWORD`
4. `click input[data-test="login-submit"]`
5. URL changes to `/account` on success

Login errors render as `[data-test="login-error"]` with red text.

## Known gotchas

- **Vue route changes don't always fire navigation events promptly.** After `Add to Cart`, the cart badge updates async via a Pinia store — wait on the badge incrementing rather than on a URL change.
- **Search box debounces 300ms** before issuing a request. If a snippet types and immediately checks results, wait for the network to settle first.
- **The password-strength meter blocks the register submit** until "Strong" — a `register` snippet must use a password complex enough to clear that bar (mix of upper/lower/digit/symbol, 8+ chars).
- **Locale defaults to en-US.** Form validation messages assume English; don't hardcode them in assertions if cross-locale matters.
