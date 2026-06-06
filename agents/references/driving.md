# Driving the forge session

You drive the browser through the `playwright-cli` skill. **Load it before your first action** — it owns the command vocabulary, and re-stating it here would just go stale. Use the Skill tool with `playwright-cli` as the skill name.

Every action is scoped to the `-s=forge` session, which the caller has already established (either attached to a real Chrome via CDP or launched as a managed `--persistent` browser). You do *not* need to `open`, `attach`, or `close` — the session is already there.

## Always open a fresh tab first

**Before any other driving action**, create a new tab so you don't hijack a pinned, bookmarked, or in-progress tab the user has open:

```bash
playwright-cli -s=forge tab-new about:blank
```

`tab-new` focuses the newly-created tab, so subsequent commands (`goto`, `click`, `fill`, `snapshot`, `run-code`) operate on it. This is critical when attached to the user's real browser via CDP: playwright-cli's default page is otherwise an arbitrary existing tab.

The new tab is visible to the user — they see it open and can watch you drive. Don't close it when you're done; leave it as evidence of the path the snippet now captures.

## The drive-observe-act loop

1. **Observe** — `playwright-cli -s=forge snapshot` to see the current page. Read the ARIA tree (not the raw DOM) and the element refs (`e1`, `e2`, ...) that come back.
2. **Plan** — based on the snapshot and the goal, decide the next action (one at a time is fine; this is conversation, not batch).
3. **Act** — `playwright-cli -s=forge click e3`, `... fill e5 "value"`, etc.
4. **Read what playwright-cli wrote** — every action prints the equivalent Playwright TS code (`await page.getByRole('button', { name: 'Submit' }).click();`). **Collect this code.** It's the raw material for your snippet's `run()` body.

Keep going until the goal is reached. Then snapshot once more to confirm, and move to synthesis.

## What to collect for the snippet

playwright-cli outputs Playwright TS code for each interaction. As you go, build up the *successful* sequence:

```ts
// from `playwright-cli -s=forge fill e1 "user@example.com"`
await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');

// from `playwright-cli -s=forge fill e2 "..."`
await page.getByRole('textbox', { name: 'Password' }).fill('...');

// from `playwright-cli -s=forge click e3`
await page.getByRole('button', { name: 'Sign In' }).click();
```

That becomes your snippet body — with credentials replaced by `args` or `process.env`, and explicit waits added where needed.

## Don't include exploration

If you tried clicking `e7` and it was the wrong element, or you navigated somewhere and had to backtrack — **don't include those steps in the snippet**. The snippet is the recipe that succeeded, not the journal of how you found it.

## Selector preference

playwright-cli already generates semantic locators (`getByRole`, `getByText`, `getByLabel`) when the element has accessible attributes. If you see it falling back to CSS selectors, that's a sign the page is under-instrumented — it's not your problem to fix, but note it: the snippet will be more fragile, and a future repair pass might want to revisit it.

## When you need behaviour playwright-cli doesn't have a verb for

Use `playwright-cli -s=forge run-code "async page => { ... }"` for one-off Playwright calls that don't have CLI equivalents (waiting on a specific load state, evaluating arbitrary JS, working with frames, etc.). The same constraint applies: the body must be self-contained.

## When to stop

- **Goal achieved** — observed end state matches what the caller asked for. Snapshot once to confirm, then synthesise.
- **Loop limit** — give yourself a budget (e.g. 10 rounds). If you're past that, you're either over-driving or the goal isn't achievable in the current state. Bail with `cannot-author: <reason>`.
- **Repeated failure** — if the same action fails 3 times across attempted variants, the page isn't in the state you think it is. Snapshot, reassess, and either re-route or bail.

## Never

- `playwright-cli -s=forge close` / `... detach` / `... delete-data` — the session is shared infrastructure. Tearing it down breaks the caller and anything else using it.
- `playwright-cli -s=forge goto <fresh-url>` *unless the goal explicitly requires navigation*. If the user was mid-task in a tab, navigating away wipes their work-in-progress. Snapshot first; navigate only when intentional.
