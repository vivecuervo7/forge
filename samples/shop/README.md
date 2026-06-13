# shop — practicesoftwaretesting.com

[practicesoftwaretesting.com](https://practicesoftwaretesting.com) is a modern Angular 20 + Bootstrap 5 e-commerce + tool-rental platform. JWT-based auth, `data-test` attributes throughout, multi-step checkout (cart → sign-in → address → payment → confirm), 5 payment methods, real form validation including a password-strength meter on registration. The official docs live at [testsmith-io.github.io/practice-software-testing](https://testsmith-io.github.io/practice-software-testing/).

This target is the **clearest demonstration of hint quality's impact on forge's spec-mode output**. The same task — complete a hammer checkout end-to-end — was driven three times against three different hint sets and produced three qualitatively different specs.

## Runs

- [`run-1/`](./run-1) — **bare-minimum hints.** `forge.md` covers the env contract + test accounts only. No `driver.md`. The driver discovers routes, selectors, and the Angular zone.js dispatchEvent quirk on its own.
- [`run-2/`](./run-2) — **comprehensive hints from manual exploration.** `driver.md` written after roughly one hour of clicking through the app and noting selectors and gotchas.
- [`run-3/`](./run-3) — **comprehensive hints from official documentation.** Same `driver.md` shape as run-2, but rewritten from the app's public docs rather than manual exploration. Includes documented async patterns, validation rules, role differences, framework identification, and the deliberate absence of a public state-reset endpoint.

## Scenarios

Each run executed two scenarios:

- **Scenario A** — drive mode: open the home page, search for "hammer", add the first result to the cart, confirm the cart badge incremented.
- **Scenario B** — spec mode: full checkout end-to-end (cart → sign-in → address → payment → confirm), with a verified spec composed at the end.

## What to compare

Open run-1, run-2, and run-3 side by side. The key artifacts to compare:

1. **`hints/driver.md`** — see the progression from "nothing" to "selectors and gotchas I noticed" to "selectors and gotchas the official docs document." The third is the cleanest template for your own `driver.md`.
2. **`specs/`** — same task, three specs. Run-1 hardcodes a product URL discovered during the drive. Run-2 and run-3 both compose `search → open-first → add-to-cart` snippets, never naming a specific product.
3. **`snippets/`** — run-3 has the most decomposed library because the hint's selector inventory gave snippet-author obvious boundaries to scope around.

The headline finding: **comprehensive doc-grounded hints take spec-mode forge from "iterate to discover framework quirks" to "first-try pass."** The Angular zone.js / dispatchEvent quirk that took multiple verifier iterations to discover in run-1 and run-2 was documented up-front in run-3's hints, so the driver baked the workaround into the first drive and the spec verified from cold start on the first attempt.

This is the value of writing your hint files from your app's documentation rather than from scratch.
