# Project notes for forge

Bare-minimum project knowledge for practicesoftwaretesting.com — covers authentication only. No app structure, no routes, no selectors. Phase 1 of the hint-impact comparison.

## Authentication

The site requires logging in. Forge expects these env vars when running anything that touches the logged-in surface:

- `PST_EMAIL` — a registered customer account email
- `PST_PASSWORD` — its password

## Test accounts available

The project publishes shared demo accounts (no signup needed):

- `customer@practicesoftwaretesting.com` / `welcome01`
- `customer2@practicesoftwaretesting.com` / `welcome01`

Two accounts → forge can run two scenarios in parallel without their cart state colliding. If both are in use, the third concurrent run waits.

## Adding another test account to the rotation

If forge tells you it needs another account (e.g. you're trying to run a third parallel scenario), it can mint one from this list:

| Identifier | Email | Password |
|---|---|---|
| `customer`  | `customer@practicesoftwaretesting.com`  | `welcome01` |
| `customer2` | `customer2@practicesoftwaretesting.com` | `welcome01` |

That's the full set — practicesoftwaretesting.com doesn't accept arbitrary signups for forge's purposes, so don't invent a third identity.
