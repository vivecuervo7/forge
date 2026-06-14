# Project notes for forge

Project knowledge for practicesoftwaretesting.com, sourced from the official documentation at https://testsmith-io.github.io/practice-software-testing/.

## What this project is

The Practice Software Testing app — Angular 20 + Laravel 12 e-commerce + tool-rental platform, deliberately built as a software-testing playground. The live demo at `https://practicesoftwaretesting.com` runs sprint 5 (the full-platform version). Sprint 1–4 plus a deliberate-bugs and a performance-degradation variant are hosted at `sprint{N}.practicesoftwaretesting.com` if you ever need a reduced or instrumented surface.

## Authentication

REST API uses JWT-based auth. The frontend logs in via `POST /auth/login`, stores the JWT in localStorage, and sends it as a Bearer token on subsequent requests. OAuth (Google/GitHub) is also supported by the app but isn't useful for automation — stick to email/password for forge runs.

## Test accounts

The deployment seeds shared demo accounts (no signup needed). Three are documented here; each maps to a pair of env keys the driver references via native shell expansion when invoking auth-bearing snippets.

| Account keyword | Role | Env keys |
|---|---|---|
| `customer`  | customer | `PST_CUSTOMER_EMAIL` / `PST_CUSTOMER_PASSWORD` |
| `customer2` | customer | `PST_CUSTOMER2_EMAIL` / `PST_CUSTOMER2_PASSWORD` |
| `admin`     | admin    | `PST_ADMIN_EMAIL` / `PST_ADMIN_PASSWORD` |

The actual email / password values for these seeded accounts are documented in the [demo's official docs](https://testsmith-io.github.io/practice-software-testing/) — look up the test-account credentials there and set them in your env layer (direnv, `.env`, etc.). This hint file deliberately doesn't list them: even publicly-documented credentials shouldn't sit in a tracked hint file. The same discipline the driver follows at runtime (env values stay in env, never in tracked files) applies to the hint that documents them.

Notes:
- TOTP setup is denied for `customer` and `admin`. Don't try to enable it during a drive.
- `admin` is exempt from the account-lockout policy.
- Two customer accounts (`customer` + `customer2`) let two parallel forge sessions run without cart/order collision. The third concurrent run waits.

### How the driver references these

When the user names an account in a task ("log in as customer", "drive as admin"), the driver looks up the matching env keys from this table and references them via native shell expansion in its Bash command:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-invoke-snippet.mjs -s=<SESSION> \
  --snippet <FORGE_ROOT>/snippets/checkout-login.ts \
  --args "{\"email\":\"$PST_CUSTOMER_EMAIL\",\"password\":\"$PST_CUSTOMER_PASSWORD\"}"
```

The shell expands `$PST_CUSTOMER_EMAIL` at exec time; the literal credential never appears in the tool-call transcript. This applies uniformly to every env-sourced value — see the agent prompt's "Environment variables" section for the full rule.

### Where the values live

Forge doesn't load env on your behalf. You decide how `$PST_CUSTOMER_EMAIL` etc. reach `process.env`:

- **direnv** — add the keys to `.envrc.local`; direnv populates them in your shell automatically. Recommended.
- **`forge/.env` via dotenv** — uncomment the `import 'dotenv/config'` line in `forge/playwright.config.ts`; forge will load `forge/.env` at config-load time. The `.env.example` in this sample shows the keys.
- **manual exports** — `export PST_CUSTOMER_EMAIL=customer@...` in your shell.
- **dotenv-cli / secrets manager / whatever fits** — forge takes no opinion on how values reach `process.env`.

## Adding another test account

The seeded set is fixed; the deployed demo doesn't expose a mint-on-demand endpoint. To use a fresh account:

1. Register via `/auth/register` (the password-strength meter requires `Strong` or higher — use 8+ chars with mixed case, digit, symbol).
2. Add a new row to the table above with a chosen keyword and a new pair of env keys (e.g. `PST_TESTER_EMAIL` / `PST_TESTER_PASSWORD`).
3. Set the values in your env layer (direnv, `.env`, etc.).

The new account persists until the demo redeploys; for a long-lived rotation expect to re-register periodically.

## Setup before each run

Each session launches its own ephemeral chromium profile, so browser-side state — JWT in localStorage, cart in client storage — starts clean without configuration.

There is **no public state-reset endpoint** on the deployed demo. The docs describe a local Docker reset (`docker compose exec laravel-api php artisan migrate:fresh --seed`), but that's local-only — the hosted demo runs whatever's currently deployed and accumulates state across all users' interactions.

Practical implication: specs that mutate server-side state (placing orders, registering accounts, updating profile) cannot be reset between runs. **Design specs to tolerate state drift** — assert on shape rather than value (`/INV-\d+/` not `INV-2026000042`), search for products dynamically instead of hardcoding UUIDs, treat any cart contents as the starting point rather than expecting an empty cart.

## Teardown after each run

None required. There's no server-side cleanup forge can drive; the start-of-next-run scrub handles client-side state.
