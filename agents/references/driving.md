# Driving the forge session

You drive the browser through the `playwright-cli` skill. **Load it before your first action** — it owns the command vocabulary, and re-stating it here would just go stale. Use the Skill tool with `playwright-cli` as the skill name.

Every action is scoped to the `-s=forge` session, which the caller has already established (either attached to a real Chrome via CDP or launched as a managed browser). You do *not* need to `open`, `attach`, or `close` — the session is already there.

## Critical: route every command through `forge-registry.mjs drive`

Don't use `playwright-cli -s=forge <command>` directly during a driver run. Instead, use:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive <playwright-cli command-and-args>
```

For example, what would have been:
```bash
playwright-cli -s=forge goto 'https://news.ycombinator.com/'
```
becomes:
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive goto 'https://news.ycombinator.com/'
```

The `drive` wrapper:
- Passes args through to `playwright-cli -s=forge` verbatim
- Captures the Playwright code that playwright-cli emits (the `### Ran Playwright code` block)
- Appends a `drove` event to the session transcript so spec generation and collation can see what happened
- Returns the playwright-cli output to you unchanged

For read-only commands like `snapshot`, `tab-list`, `url`, no test code is emitted; the wrapper detects this and skips recording silently. Use `drive` for those too — it's harmless and saves you from having to think about which commands need recording.

The one exception: `playwright-cli list` (no `-s=forge`) for the session-presence check at the top of your run. That's a global daemon-level command, not a session action, and has no test-code equivalent. Use it directly.

## Always open a fresh tab first

**Before any other driving action**, create a new tab so you don't hijack a pinned, bookmarked, or in-progress tab the user has open:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive tab-new about:blank
```

`tab-new` focuses the newly-created tab, so subsequent commands (`goto`, `click`, `fill`, `snapshot`, `run-code`) operate on it. This is critical when attached to the user's real browser via CDP: playwright-cli's default page is otherwise an arbitrary existing tab.

The new tab is visible to the user — they see it open and can watch you drive. Don't close it when you're done.

## The drive-observe-act loop

1. **Observe** — `forge-registry.mjs drive snapshot` to see the current page. Read the ARIA tree (not the raw DOM) and the element refs (`e1`, `e2`, ...) that come back.
2. **Plan** — based on the snapshot and the task, decide the next action.
3. **Act** — `forge-registry.mjs drive click e3`, `... drive fill e5 "value"`, etc.
4. **Capture extracted values** — see "Snapshot to read, run-code to capture" below. Critical for spec reproducibility and library growth.

## Produce before you read

A capture step can only return a meaningful value if the page actually *contains* that value at the moment you read it. For static pages whose content IS the value — HN front page, a Wikipedia search results page, a settings panel showing the current config — `goto` then `run-code` is the whole flow.

But when the value is something the page must *compute* or *generate* on your behalf — a translation, a search result for a query you provided, a calculated number — you must perform the producing actions **before** the `run-code` that reads the result. Reading before producing returns whatever stale state happened to be on the page (last session's translation, cached search, whatever) and you'll capture that as if it were your own work.

```
Bad pattern (translate.google.com):
> drive goto 'https://translate.google.com'
> drive run-code "async page => { return page.locator('textarea').nth(1).inputValue() }"
[returns the previous user's translation, or empty string]

Good pattern:
> drive goto 'https://translate.google.com/?sl=en&tl=fr&text=<encoded-text>&op=translate'
  # OR
> drive goto 'https://translate.google.com'
> drive fill <source-textarea-ref> '<text-to-translate>'
> drive run-code "async page => { /* wait for translation, then return it */ }"
[returns the actual translation you produced]
```

**Rule:** if the action produces a new value, the producing actions must precede the reading run-code in the same chunk. Reading-without-producing is only acceptable for already-static page state.

If you can't tell whether the page state is "what was already there" vs "what your actions produced" — explicitly produce it. Cheap insurance; the cost of a stale-state capture is a non-reproducible snippet that future invocations will silently return garbage from.

## Snapshot to read, run-code to capture

Two distinct purposes, two distinct mechanisms — don't conflate them:

- **Snapshot** (`drive snapshot`, `drive url`, `drive tab-list`) reads the page state to **inform YOUR next decision**. The value lives in your context, not the transcript. Fine for "what should I do next?" — picking which element to click, deciding whether a flow is complete, sanity-checking the current state.

- **Run-code extraction** (`drive run-code "async page => { ... return <value> }"`) reads the page state and **records BOTH the extraction code AND the returned value to the transcript**. This is what you use whenever the value you're reading will:
  - Be returned as part of your final result to the caller
  - Be threaded forward as an arg to a later step
  - Be useful as part of a reproducible spec

**Rule of thumb:** if you find yourself reading a snapshot and then *quoting a specific value back* (a URL, a title, a count, an element's text), that value should have come through `drive run-code` instead. The snapshot is for navigation; run-code is for capture.

Bad pattern:
```
> drive snapshot
[snapshot shows search results, first result has href="..."]
> (mentally extract the URL, return it in final summary)
```

Good pattern:
```
> drive snapshot
[snapshot shows search results — orienting]
> drive run-code "async page => { return await page.locator('.first-result-link').first().getAttribute('href') }"
[result: "https://..."]
[returned value is now in the transcript, will appear in the spec, can become a snippet]
```

This applies in **all modes**, not just spec mode. Capturing-via-run-code costs nothing extra at runtime; it just means the value enters the transcript and downstream consumers (spec generation, collation, future repair) have access to it. Snapshot-then-mentally-extract leaves the value stuck in your head — fine for ephemeral decisions, wrong for anything you'll surface to the user or chain to a next step.

## Selector style

playwright-cli generates semantic locators (`getByRole`, `getByText`, `getByLabel`) when the page exposes accessible attributes. CSS selectors are a fallback. The code that gets recorded is whatever playwright-cli chose — usually fine.

If you need to override (e.g., the auto-locator picked a fragile selector), construct your own via `run-code`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive run-code "async page => {
  await page.getByRole('button', { name: 'Submit' }).click()
}"
```

This way the recorded code uses your explicit locator instead of whatever playwright-cli inferred.

## Don't let exploration pollute your captures

Every `drive` call records an event to the transcript. Drove events accumulate in a buffer that the next `capture` call sweeps up into a snippet body. If you went down a wrong path — clicked the wrong element, searched with a bad query, navigated somewhere unhelpful — those actions are in the buffer until something closes the window.

Two ways to close the window:

- **`capture`** — write the buffered events as a snippet. Use when the events represent the successful path you want to preserve.
- **`discard '<reason>'`** — throw the buffered events away with no snippet written. Use when the buffer represents exploration or recovery and you're about to retry cleanly. The reason is recorded in the transcript for forensics; the events themselves are excluded from any future snippet.

Spec generation is unaffected by either choice — all drove events (including discarded ones) appear in the inline spec. So a spec faithfully replays what you actually did, even if the snippet library only keeps the clean parts. That's intentional: specs are about reproducibility of *this run*; snippets are about reuse in *future runs*.

**When to discard rather than just drive past it:** if your next capture would unintentionally sweep up the bad-path actions, discard first. A good test: imagine a future caller invoking the snippet you're about to capture — do they want to re-run any of the actions currently in the buffer? If no, discard.

## When to stop

- **Task complete** — observed end state matches what the caller asked for. Return.
- **Recovery budget exhausted** — if you've made ~5 recovery attempts past a failure without progress, return `cannot-drive: <reason>` and let the caller decide.
- **Truly stuck** — page state, login wall, etc. that you can't navigate around. Same: `cannot-drive`.

## Never

- `playwright-cli -s=forge close` / `detach` / `delete-data` — lifecycle is user-controlled.
- `playwright-cli -s=forge goto <fresh-url>` for a tab the user had open with work in progress, unless the task explicitly requires it.
- Embedding credentials in drive args. The transcript records everything literally; use `process.env.<NAME>` references in `run-code` blocks instead.
