# Case: drive-with-library

**Type**: runbook (manual until headless `/forge` invocation is wired up)

**What it tests**: when the sandbox snippet library already covers every step of the task, the driver should invoke existing snippets rather than re-author them. Snippet-author should write 0 new files. The whole drive completes quickly because there's no novel work.

## Setup

```bash
cd ~/repos/forge-tests

# Reset slots + scrub residual state
source ~/repos/claude-plugins/plugins/forge/tests/lib/sandbox.sh
sandbox_full_reset

# Capture baseline snippet count
ls forge/snippets/*.ts | wc -l
```

Expected baseline: 3 snippets (`login-as-persona.ts`, `add-item-to-cart.ts`, `cart-get-badge-count.ts`).

## Invoke

In Claude Code, from `~/repos/forge-tests/`:

```
/forge add the backpack to the cart and tell me the badge count
```

## Assertions

After the team reports completion:

1. **Drive succeeded**. Final report says "Drove via slot-<persona>" with the expected one-liner (badge count = 1).
2. **No new snippets written**. `ls forge/snippets/*.ts | wc -l` still returns 3.
3. **Driver invoked existing snippets, not fresh-drove them**. In the team-lead session's transcript, the driver's `SendMessage` summaries to `snippet-author` should all be of the form `invoked <name>` — never `drove fresh: <name>` for the three covered steps (login, add-to-cart, badge-count).
4. **Snippet-author reports zero new authorings**. Its completion ping should say "wrote 0 snippets — drive's work was covered by existing library."
5. **Duration**. End-to-end under 90 seconds. (Slower is a smell — maybe the driver fell back to fresh drives.)

## Failure modes this catches

- Driver regression where it stops scanning the snippet library and drives every step fresh.
- Snippet-author regression where it duplicates existing snippets despite invoke summaries.
- A prompt change in `agents/driver.md` that weakens the "reuse > fresh drive" rule enough that it drives anyway.

## Notes

The first assertion (drive succeeded) is the basic functional check. Assertions 2-4 are the regression net for the snippet-reuse discipline. Assertion 5 is informational — slowness is a leading indicator of misbehavior.
