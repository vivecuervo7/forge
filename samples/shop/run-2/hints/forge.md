# Project notes for forge

Comprehensive project notes for practicesoftwaretesting.com — covers authentication, available test accounts, what to reset between runs. Phase 2 of the hint-impact comparison.

## What this project is

A forge sandbox for [practicesoftwaretesting.com](https://practicesoftwaretesting.com/) — a modern Vue 3 SPA test-shop maintained by the Practice Software Testing project. Real form validation (password-strength meter on register), paginated catalog with debounced search, multi-step checkout, customer dashboard.

## Authentication

The site requires logging in for cart, checkout, and dashboard flows. Forge expects:

- `PST_EMAIL` — a registered customer account email
- `PST_PASSWORD` — its password

## Test accounts available

The project publishes shared demo accounts (no signup needed):

| Identifier | Email | Password | Role |
|---|---|---|---|
| `customer` | `customer@practicesoftwaretesting.com` | `welcome01` | customer |
| `customer2` | `customer2@practicesoftwaretesting.com` | `welcome01` | customer (second seat for parallel runs) |
| `admin` | `admin@practicesoftwaretesting.com` | `welcome01` | admin |

The two `customer*` accounts are the right ones for end-to-end shopper flows — both can read-write and their cart/order state is independent, so two parallel runs don't collide.

## Adding another test account to the rotation

If forge needs a third account at the same time, the answer is "wait" — the site only has the three accounts above and there's no way to mint a new one for testing purposes. Forge should never invent additional identities; the site would reject the login.

## Setup before each run

The default reset is sufficient. Cart and recent-view state live in localStorage; the default scrub handles them. No database to reset, no logout endpoint that needs explicit calling.

## Teardown after each run

None. There's no server-side state worth resetting — start-of-next-run setup handles all the cleanup that matters.
