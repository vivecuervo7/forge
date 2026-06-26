# Agent — check-in protocol

This reference is loaded on-demand by any agent (the driver, others) that has hit friction it can't clear with routine recovery. It's not pre-loaded — `cat` it when you're about to change tack.

You don't classify your blocker or decide who should answer it. That routing is the **lead's** job — it's the calm, capable mind with the codebase and the user channel, and it isn't in the execution tunnel you are. Your job is simpler: **notice friction, surface it, and wait.** One upward signal — the **check-in**.

## When to check in

Try ~5 cheap recovery moves first (a different selector, a wait, a re-snapshot, dismissing a stale modal). Routine retries don't warrant a check-in — just do them.

Check in at the moment you'd **change tack** — when routine recovery is exhausted and you're about to do something materially different, *especially anything that would reach outside the browser* (read backend source, hit an API directly, inspect the server, touch the shell). That instant — "ordinary moves failed, now I'll get creative" — is exactly the moment to hand to the lead instead. **Announce the impulse before you act on it.**

Also check in when you're blocked on something only a person plausibly knows (an ambiguous next step, a missing account, a product decision, a CAPTCHA). Same signal — the lead will take it to the user if that's what it needs.

## How to check in

SendMessage's `message` field is a plain string. Use this format so the lead can read you at a glance:

```
SendMessage(
  to="team-lead",
  summary="check-in: <tight one-line of where you're stuck>",
  message="CHECK-IN

STUCK ON: <what you were trying to do and what isn't working — the UI state, the selectors, what you've already tried>

TEMPTED TO: <what you'd do next if left alone — e.g. 'look at what the Size dropdown calls in the network tab' / 'try a totally different flow' / 'nothing — I'm out of moves'>

HUNCH: <optional — what you suspect would unblock you, e.g. 'something I can't see gates this dropdown' or 'this might need a value only the user knows'. A guess, not a decision.>
"
)
```

Then **go idle** and wait — don't busy-loop, don't keep probing, and don't act on the "tempted to." The lead's reply wakes you.

## Applying the lead's reply

The lead routes and replies; you don't need to know which kind of answer it is — just do what it says:

- **"try this: `<X>`"** — a concrete next move (a selector, a step, a different approach). Apply it.
- **"wait — investigating"** — the lead is reading the code; stay idle until it follows up with an answer.
- **an answer** — what the lead found (in the code, or from the user). Apply it and resume.
- **"carry on" / "go ahead"** — your instinct was fine; proceed with what you were tempted to do, now sanctioned.

Re-check whether the issue is actually resolved before claiming progress. If the same blocker survives a few rounds of the lead's guidance, say so plainly — that's cannot-drive territory (below), and the lead will usually call it.

## Cannot-drive — terminal failure

Reserved for: work genuinely cannot continue, the lead's guidance didn't resolve the blocker after several rounds, or the task as specified is impossible in the current state.

```
SendMessage(
  to="team-lead",
  summary="cannot-drive: <reason>",
  message="<full context: what was tried, what failed, why the lead's steers didn't help>"
)
```

Then `TaskUpdate(taskId=<id>, status="completed")` — your work is done (outcome was cannot-drive, but the task as defined is finished). The lead surfaces the failure in the final report.
