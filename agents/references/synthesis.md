# Snippet synthesis

How to turn a successful drive into a `.ts` file that lands in `scratch/`.

## File layout

```ts
// $FORGE_ROOT/scratch/<name>.ts
export const meta = {
  description: '<one-line summary, present tense, ≤120 chars>',
  preconditions: { /* see Preconditions below */ },
  args: { /* see Args below */ },
  tags: ['<topic-or-domain>', '<tech>', '<kind>'],
}

export async function run(page, args) {
  // The successful sequence, expressed in idiomatic Playwright.
  // MUST be self-contained — see "run-code constraints" below.
}
```

## Hard schema rules

The `meta` object has **exactly** these keys. Do not invent others.

- **No `name` field.** The filename is the snippet name — single source of truth. Adding `meta.name = "..."` is redundant and drifts under rename.
- **`preconditions.url` is a `RegExp` literal**, written `/pattern/flags`. Not a string. The registry serialises it back out via `re.source` and `re.flags` at invoke time; strings work too but read as "I forgot the slashes" rather than intent.
- **`args` values are type-name strings**, not JS types. `args: { rank: '?number' }` — not `args: { rank: Number }`.
- **`tags` is an array of strings**, even when there's only one. Optional but encouraged for retrieval; if you can name a domain, a tech, or a kind (`bugfix`, `scrape`, `auth-flow`), include them.
- **`description` is on a single line**, no template literals, no concatenation. The registry's index parser regexes the first `description: '...'` line in `meta`; multi-line breaks it.
- **Any args declared in `meta.args` must be reflected in the description** — otherwise Claude won't know it can pass them.

## ⚠️ run-code constraints

The `run()` body is extracted at invocation time and run inside `playwright-cli -s=forge run-code "async page => { ... }"`. That sandbox provides exactly one thing: `page`. Everything else must come from JS built-ins.

**Therefore:**

- ❌ No `import` statements anywhere in the file's `run` body. `import { foo } from '...'` will fail.
- ❌ No `require()`.
- ❌ No references to top-level helpers (other functions in the file). The extraction is body-only — only what's inside `run`'s braces survives.
- ❌ No types-only TS imports (`import type { Page }`) — they vanish at type-strip time but linters / IDE may add them; remove before committing.
- ✅ Plain `async`/`await`, control flow, JSON, `Math`, `Date`, regex, `process.env.NAME` for secrets.
- ✅ The full Playwright `page` API: `page.getByRole(...)`, `page.locator(...)`, `page.evaluate(...)`, `page.goto(...)`, etc.

If you need a helper inside the body, define it as a local function inside `run`:

```ts
export async function run(page, args) {
  async function waitForRowCount(n) { /* ... */ }
  await waitForRowCount(args.expected)
}
```

## Naming

- kebab-case, descriptive, action-oriented: `login-as-admin`, `paste-gif-to-pr`, `create-card-and-add-to-deck`.
- If the caller suggested a name, use it unless it clashes with an existing snippet.
- If a snippet with the same name exists in any tier, append a disambiguating suffix (`-v2`, `-gh-flavoured`) — do **not** overwrite.

## Description

A single line, present tense, what the snippet *does*:

- ✅ `Paste a local GIF into a GitHub PR description by URL`
- ✅ `Log in as the admin user from the home page`
- ❌ `This snippet will log you in...` (no future tense, no meta-words)
- ❌ `Handles login` (too vague)

This line lands verbatim in `INDEX.md` and is what Claude reads to decide whether to reuse this snippet later. Be specific.

## Preconditions

The state the page must be in for `run()` to make sense. Two keys supported today:

- **`url`** — a `RegExp` matched against `page.url()`. Use whenever the snippet only works on certain pages. Prefer broad-enough patterns to cover variations (e.g. `/github\.com\/.+\/pull\/\d+/`, not `/github\.com\/myorg\/myrepo\/pull\/42/`).
- **`visible`** — a string or array of strings whose visibility confirms the page is in the expected state ("Crafting", "Sign in", "Repository overview"). Pick text that's specific to the snippet's starting state, not generic chrome.

The registry compiles these into runtime checks that run *before* your `run()` body, throwing with `precondition:` prefix on failure. Whenever the snippet assumes anything about the page, declare it — the registry surfaces failures as `precondition` errors rather than mid-flow selector errors.

## Args

A `{name: type}` map. Types are informational strings today; the registry doesn't validate them, but they document the contract.

- Use the same names the caller used in the brief.
- For secrets, the value type is `"env:NAME"` (e.g. `password: 'env:ADMIN_PASSWORD'`) and the `run()` body reads `process.env.NAME`. Never accept secret values directly in `args` — the caller might log them, the journal might capture them.
- Optional args: type prefixed with `?` (`note: '?string'`).
- Defaults belong inside `run()`, not in `meta.args`.

## Parameterisation

Default to the concrete behaviour the caller asked for, but anticipate **one or two likely variations** and parameterise for them — with defaults that reproduce the first-use behaviour exactly. This is how a single snippet covers a family of related requests without forcing every variation to be a fresh authoring trip.

**The heuristic:** ask yourself "if the same user came back tomorrow with a slightly different version of this request, what would change?". If 1–2 obvious axes pop out, parameterise. If the answer is "I have no idea", just write the concrete version.

**Example — get the top story title on HN:**

❌ Too rigid (only handles one request):
```ts
export const meta = {
  description: 'Get the title of the top story on Hacker News',
  args: {},
}
export async function run(page) {
  return await page.locator('.titleline a').first().textContent()
}
```

✅ Parameterised but with a sensible default:
```ts
export const meta = {
  description: 'Get the title of an HN front-page story (default: top story; pass {rank: n} for the n-th, or {rank: "all"} for the full list)',
  args: { rank: '?number|"all"' },
}
export async function run(page, { rank = 1 } = {}) {
  const titles = await page.locator('.titleline a').allTextContents()
  if (rank === 'all') return titles
  return titles[rank - 1] ?? null
}
```

✗ Over-engineered (predicting variations no one asked for):
```ts
args: {
  rank: '?number|"all"',
  withScore: '?boolean',
  withAuthor: '?boolean',
  filterByDomain: '?string',
  sortBy: '?"score"|"comments"|"age"',
}
```
You'd be inventing requirements. Don't.

**Rule of thumb:** one or two args max for the first authoring pass. If reuse later proves a third variation is wanted, the agent on that future pass can re-author or extend.

**Description must reflect args.** If the snippet accepts `{rank}`, the description should mention it (e.g. "default: top story; pass `{rank: n}` for the n-th") — otherwise Claude won't know it can pass args, and the parameterisation goes unused.

## The `run()` body

- **Use idiomatic Playwright** — the code playwright-cli already generated for you during the drive is the starting point. Don't rewrite it; refine it.
- **Prefer semantic locators**: `getByRole`, `getByLabel`, `getByText`. Fall back to CSS only when nothing else works.
- **Wait for state, not for time**: `await page.getByText('Done').waitFor()`, not `await page.waitForTimeout(2000)`.
- **Return useful data**: end-state URL, IDs of created entities, anything the caller might want to assert against. Returning `undefined` is fine if there's nothing meaningful.
- **Throw on unrecoverable failure**: the registry catches and records it. Don't try to "handle" missing elements by returning success — let the failure surface.

## Example

```ts
export const meta = {
  description: 'Create a new event in EventsAir and return its ID',
  preconditions: {
    url: /eventsair\.com\/dashboard/,
    visible: 'Events',
  },
  args: { name: 'string', startDate: 'string' },
  tags: ['eventsair', 'create', 'event'],
}

export async function run(page, { name, startDate }) {
  await page.getByRole('button', { name: 'New event' }).click()
  await page.getByLabel('Event name').fill(name)
  await page.getByLabel('Start date').fill(startDate)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByText(name).waitFor()
  const url = page.url()
  const idMatch = url.match(/\/events\/(\d+)/)
  return { url, eventId: idMatch ? idMatch[1] : null }
}
```

## After writing

Always re-run the registry's reindex so the new snippet appears in `INDEX.md`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs reindex
```

The registry parses the first `description: '...'` line in `meta` with a regex, so keep that line single-line and use plain quotes (no template literals, no concatenation).
