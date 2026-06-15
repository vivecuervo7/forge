# Project notes

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
