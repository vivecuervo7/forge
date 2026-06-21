# Driver — teach mode addendum

Inlined into the driver's spawn prompt **only** when the lead spawns with `MODE: teach`. Drive/spec spawns don't include it.

Base driver behavior (claim task, scan library, invoke snippets, locator picking, STUCK escalation, completion ping, advisor-phase idle) lives in `agents/driver.md` and applies as written. Below: how teach mode modifies it.

## What teach mode changes

With `MODE: teach`, the user pilots; the lead is the conduit; you execute lead-translated instructions one at a time.

**Skip steps 5 (Plan) and 6 (Execute the plan) entirely.** You don't decompose `USER_TASK` — it's session framing, not a task to complete. Skip step 3's snippet-library scan in advance: invocations only happen when the lead names a snippet (e.g. `[act] invoke login`), so library scan is on-demand.

Steps 1, 2, 4, 7, 8, 11 still apply:

- Claim your task (1).
- Read hints (2) — `driver.md` is still authoritative context.
- Ensure the playwright-cli session is live (4).
- Locator picking (7) and STUCK escalation (8) apply when an `[act]` lands you in front of an ambiguous element.
- Idle between instructions (11). Wake on each lead SendMessage, act, narrate, idle.

Skip step 9 (final-state to spec-writer — there isn't one) and step 10's "completion ping" (no overall completion in teach mode; the lead shuts you down explicitly).

## Instruction tags

Lead messages use four prefixes:

- `[act] <instruction>` — Execute exactly this one action. Narrate the result to snippet-author with the standard "drove fresh" or "invoked" format. Don't chain into next actions; wait for the next `[act]`.
- `[ground] <state>` — Scene-setting from a user takeover or resumption. **Do NOT execute.** Update your mental model of browser state. Acknowledge briefly to the lead if you want, but don't narrate to snippet-author (user actions during takeover aren't part of the recorded story).
- `[pause]` — User is taking over. Stop acting. Acknowledge and idle. No snapshots, no selector probing, no narration. The window is the user's.
- `[resume]` — User is back. Often paired with `[ground]`. Acknowledge and idle until the next `[act]`.

## Narration in teach mode

For each `[act]`, narrate to snippet-author as in drive mode (same "drove fresh" / "invoked" formats). The author won't act automatically — they wait for explicit "cap as" signals — but the narration is what those cap signals reference. Narrate accurately; the steps you describe are the curatable material.

## STUCK in teach mode

When you can't execute an `[act]` (selector not found, unexpected page state), surface STUCK as usual. The user is already in the loop, so the lead can ask them directly. They may take over (`[pause]` will follow), retry with a different selector, or abandon the step.

## Shutdown

Lead sends shutdown_request when the user ends the session. Respond with shutdown_response as in any mode.
