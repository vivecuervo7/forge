# Project notes for forge

Project knowledge for practicesoftwaretesting.com, sourced from the official documentation at https://testsmith-io.github.io/practice-software-testing/.

## What this project is

The Practice Software Testing app — Angular 20 + Laravel 12 e-commerce + tool-rental platform, deliberately built as a software-testing playground. The live demo at `https://practicesoftwaretesting.com` runs sprint 5 (the full-platform version). Sprint 1–4 plus a deliberate-bugs and a performance-degradation variant are hosted at `sprint{N}.practicesoftwaretesting.com` if you ever need a reduced or instrumented surface.

## Authentication

REST API uses JWT-based auth. The frontend logs in via `POST /auth/login`, stores the JWT in localStorage, and sends it as a Bearer token on subsequent requests. OAuth (Google/GitHub) is also supported by the app but isn't useful for automation — stick to email/password for forge runs.

Forge expects:

- `PST_EMAIL` — registered customer account email
- `PST_PASSWORD` — its password

## Test accounts available

The deployment seeds shared demo accounts (no signup needed):

| Identifier | Email | Password | Role | Notes |
|---|---|---|---|---|
| `customer`  | `customer@practicesoftwaretesting.com`  | `welcome01` | customer | Standard test account. TOTP setup denied. |
| `customer2` | `customer2@practicesoftwaretesting.com` | `welcome01` | customer | Second seat for parallel runs. Independent cart/order state. |
| `admin`     | `admin@practicesoftwaretesting.com`     | `welcome01` | admin | Admin dashboard access. Exempt from account-lockout. TOTP setup denied. |

Two customer accounts → two slots can run in parallel without cart/order collision. If both are in use, the third concurrent run waits.

## Adding another test account to the rotation

The seeded set is fixed (customer + customer2 + admin); the deployed demo doesn't expose a mint-on-demand endpoint. The realistic path for a third concurrent customer:

1. Register a fresh account via `/auth/register`. The password-strength meter requires `Strong` or higher — use 8+ chars with mixed upper/lower/digit/symbol.
2. Add the new identifier to the rotation by creating `<POOL_DIR>/slot-<identifier>/` with `.env` containing the new `PST_EMAIL` / `PST_PASSWORD` and a `state.json` of `{ "checkedOutBy": null }`.

The new account persists until the demo redeploys (no guarantees on cadence). For ephemeral runs this is fine; for a long-lived rotation, expect to re-register periodically.

## Setup before each run

The default profile scrub (cookies + localStorage + sessionStorage) is sufficient. JWT lives in localStorage; the scrub clears it. Cart state for guest sessions also lives client-side and is covered.

There is **no public state-reset endpoint** on the deployed demo. The docs describe a local Docker reset (`docker compose exec laravel-api php artisan migrate:fresh --seed`), but that's local-only — the hosted demo at practicesoftwaretesting.com runs whatever's currently deployed and accumulates state across all users' interactions.

Practical implication: specs that mutate server-side state (placing orders, registering accounts, updating profile) cannot be reset between runs. **Design specs to tolerate state drift** — assert on shape rather than value (`/INV-\d+/` not `INV-2026000042`), search for products dynamically instead of hardcoding UUIDs, treat any cart contents as the starting point rather than expecting an empty cart.

## Teardown after each run

None required. There's no server-side cleanup forge can drive; the start-of-next-run scrub handles client-side state.
