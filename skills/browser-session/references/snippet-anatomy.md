# Snippet anatomy

Every snippet is a plain ES module (`.ts` file) with two exports: `meta` and `run`.

## Shape

```ts
export const meta = {
  description: 'One-line summary used by the retrieval index',
  preconditions: {
    url: /github\.com\/.+\/pull\/\d+/,    // RegExp or string-pattern matched against page.url()
    visible: 'Leave a comment',           // string or string[] — text(s) that must be visible
  },
  args: { gifPath: 'string', prUrl: 'string' },
  tags: ['github', 'pr', 'upload'],
}

export async function run(page, args) {
  // page is a Playwright Page already attached over CDP to the user's live session.
  // Whatever you return is included in the registry's invoke output.
}
```

## Fields

- **`description`** — single line, used verbatim in `INDEX.md`. Make it specific enough that Claude can pick this snippet over a similar one without reading the body. The index parser extracts this with a regex against the first `description: '...'` line in `meta`, so keep it on one line and use single/double/backtick quotes (no template interpolation).

- **`preconditions`** — checked *before* `run()` is called. Two keys supported today:
  - `url`: a `RegExp` (or string pattern) tested against `page.url()`. Use this whenever the snippet only makes sense on certain pages.
  - `visible`: a string or array of strings. Each must be visible on the page (Playwright's `getByText(...).first().isVisible()`). Catches "user isn't logged in" or "modal hasn't opened yet" before selector errors leak out three steps deep.

  Missing preconditions are fine — but in that case the snippet is responsible for self-checking. Prefer to declare them so failures surface as `precondition` rather than `run` errors.

- **`args`** — informational only today. A `{name: typeName}` map that Claude reads to know what to pass. Not enforced at runtime; if a future step adds schema validation, this is where it'll live.

- **`tags`** — optional, for future retrieval / filtering. Not used by the bare registry.

## `run(page, args)`

- `page` is the Playwright `Page` from the active `forge` playwright-cli session. The browser is *shared* — don't close it, don't navigate away from work the user has in flight unless that's the whole point of the snippet.
- `args` is whatever the caller passed (parsed JSON). The snippet is responsible for its own arg validation today.
- Throw on unrecoverable errors. The registry catches and records as an `invoke-failed` history event.
- Return whatever's useful to the caller — a `result` field in the invocation output. Returning `undefined` is fine.

## ⚠️ run-code constraints

The `run()` body is extracted at invocation time and run inside `playwright-cli -s=forge run-code "async page => { ... }"`. That sandbox provides `page` and JS built-ins — nothing else.

- ❌ No `import` statements. They will fail at run-code time.
- ❌ No `require()`.
- ❌ No references to other top-level functions in the file — only the body inside `run`'s braces survives extraction.
- ✅ Local helper functions defined *inside* `run`'s body are fine.
- ✅ Plain `async`/`await`, control flow, regex, JSON, `Math`, `Date`, `process.env.NAME`.
- ✅ The full Playwright `page` API.

## Conventions

- **No top-level side effects.** Importing the snippet must be cheap and pure (the registry imports it just to read meta and stringify `run`).
- **No `import` of test runners** (`@playwright/test`). Use plain Playwright API on `page` only.
- **Credentials never live in args defaults or top-level constants.** Pass through `process.env` for secrets; declare the env-var name in `meta.args` as `"env:NAME"`.

## Where snippets live

- `scratch/` — newly authored or one-off. 7d TTL once cleanup is wired up.
- `staged/` — promoted on second successful use.
- `library/` — promoted on third successful use; never auto-deleted.
- `broken/` — quarantined after a failed repair. Don't invoke from here.

Move snippets between tiers only via the (future) promotion machinery or explicit `mv`. Editing the file in place is fine — the registry re-reads on every invocation.
