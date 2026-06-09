# Driving the forge session

All browser actions go through one command:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive <command-and-args>
```

The supported commands are the standard Playwright actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `hover`, `type`, `tab-new`, `tab-list`, `url`, `snapshot`, `run-code`, and a few more. They behave the way you'd expect from Playwright; pass them through `drive` and the wrapper records the resulting Playwright code to the session transcript so the author and spec-writer agents can read what happened after you return.

Read-only commands (`snapshot`, `tab-list`, `url`) emit no recordable code; the wrapper passes them through silently. You don't have to decide which commands need recording — use `drive` for all of them.

## Always open a fresh tab first

Before any other action, create a new tab so you don't hijack a pinned, bookmarked, or in-progress tab the user has open:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive tab-new about:blank
```

`tab-new` focuses the newly-created tab; subsequent `drive` calls operate on it. The new tab is visible to the user — they see it open and can watch you work.

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

## Picking locators — enumerate then decide

You pick the locator for every action that targets a specific element. The wrapper no longer guesses one for you. The pattern:

1. **Generate candidates.** After a `snapshot` orients you, write 2-4 candidate locator expressions for the target element at different specificity levels — semantic first, anchored CSS as fallback, broad CSS last:
   ```
   page.getByRole('button', { name: 'Submit' })          // semantic — best when accessible name is reliable
   page.getByLabel('Email address')                        // semantic — for form fields
   page.locator('[role="combobox"][id*="brandId"]')       // anchored CSS — when role + attribute is unique
   page.locator('[id*="brandId"]')                         // broad CSS — last resort; expect ambiguity warnings
   ```

2. **Validate the set in one call:**
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs describe --candidates \
     '["page.getByRole(\"button\", { name: \"Submit\" })", "page.locator(\"[id*=submitBtn]\")"]'
   ```
   The response is JSON:
   ```json
   {
     "candidates": [
       { "locator": "...", "matches": 1, "details": [{ "tag": "button", "role": null, "text": "Submit" }] },
       { "locator": "...", "matches": 2, "details": [{...}, {...}] }
     ],
     "identity": [[0], [1]],
     "decisive": false,
     "snapshot": { "chosen": "<button id=...>Submit</button>", "parent": "<form ...>", "siblings": [...] }
   }
   ```
   `identity` groups candidates whose first-match resolved to the same DOM node — confirmed by temporarily tagging each match with `data-forge-mark` and reading back which tags landed where. Two candidates in the same group are proven equivalent for action purposes. `decisive` is true iff all uniquely-matching candidates fall into ONE identity group; otherwise the agent has to choose between distinct targets.

3. **Pick the best.** Compare match counts and element details. Prefer single-match over multi-match. Prefer semantic locators (`getByRole`+name, `getByLabel`) over CSS attribute matches when both uniquely match. Reject any candidate whose matching element has the wrong tag/role for your intent (a `label` when you wanted the `combobox`, a wrapper `div` when you wanted the interactive element). When `identity` shows multiple candidates in the same group, they're equivalent — pick whichever is most readable.

4. **Act via `drive run-code` with the chosen locator inline.** When the `describe` response was non-decisive, pass the JSON back via `--evidence` so the deliberation is recorded in the transcript for downstream agents:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs drive run-code \
     "async page => { await page.getByRole('button', { name: 'Submit' }).click() }" \
     --evidence '<describe-output-json>'
   ```
   When decisive, omit `--evidence` — the transcript stays light because the choice was unambiguous.

This pattern catches a class of failures that used to slip through to spec replay — ambiguous selectors that worked on first run because `.first()` happened to pick the right element, then broke on replay because page structure shifted or the matched set ordered differently. Deliberating up front, with the live DOM available, removes the guesswork.

## Exploration and recovery

Every `drive` call records to the transcript. Recoveries, dead-ends, wrong clicks — all of it ends up in the log. That's fine: the author agent reads the full transcript with hindsight and recognises exploration vs successful path on its own. You don't need to "close a window" or otherwise mark events for exclusion.

When intent is genuinely ambiguous from actions alone, drop a `note`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-registry.mjs note 'wikipedia rejected colon-title, retrying with bare brand name'
```

Notes are pure free text; they go in the transcript as hints the author will pick up. Use them sparingly — only when the shape of events wouldn't tell the story on its own. Don't narrate.

## When to stop

- **Task complete** — observed end state matches what the caller asked for. Return.
- **Recovery budget exhausted** — if you've made ~5 recovery attempts past a failure without progress, return `cannot-drive: <reason>` and let the caller decide.
- **Truly stuck** — page state, login wall, etc. that you can't navigate around. Same: `cannot-drive`.
