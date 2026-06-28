# Escalation protocol — the check-in

forge's teammates hand a blocker up rather than carrying it alone or reaching past their own scope to solve it. When the driver hits friction that routine recovery won't clear, it **checks in** with the team-lead; the lead **routes**. This file is the one place that protocol lives — both sides read it, so the message shapes never drift and each knows what the other will do.

Loaded on-demand: the **driver** `cat`s it when it hits friction; the **lead** has it from setup. The driver acts on §1–§2; the lead acts on §1 + §3.

## 1. The contract (both sides)

One upward signal — the **check-in** — and a small reply vocabulary. (Plus `cannot-drive` for terminal failure.)

**Check-in** — `message` is a plain string:

```
SendMessage(
  to="team-lead",
  summary="check-in: <tight one-line of where you're stuck>",
  message="CHECK-IN

STUCK ON: <what you were trying to do and what isn't working — UI state, selectors, what you've already tried>

TEMPTED TO: <what you'd do next if left alone — e.g. 'look at what the Size dropdown calls in the network tab' / 'try a different flow' / 'nothing, I'm out of moves'>

HUNCH: <optional — what you suspect would unblock you. A guess, not a decision.>
"
)
```

**Reply vocabulary** — the lead answers with one of:

- `try this: <X>` — a concrete next move (selector, step, approach).
- `wait — investigating` — the lead is reading the code; stay idle for the follow-up.
- *an answer* — what the lead found (in the code, or from the user).
- `carry on` / `go ahead` — the instinct was fine; proceed with it, now sanctioned.

**cannot-drive** — terminal failure (work can't continue / the lead's guidance didn't resolve it after several rounds / the task is impossible in this state):

```
SendMessage(to="team-lead", summary="cannot-drive: <reason>", message="<full context: tried, failed, why the steers didn't help>")
```

Then `TaskUpdate(taskId=<id>, status="completed")` — the work is done (outcome was cannot-drive); the lead surfaces it in the report.

## 2. Driver side — how to check in

You don't classify your blocker or decide who should answer it — **that routing is §3, the lead's job, not yours.** §3 is here so you can *trust the handoff and hand up early*, not so you can predict the lead's call. Your job is simpler: notice friction, surface it, wait.

- **Recover first.** Try ~5 cheap moves (a different selector, a wait, a re-snapshot, dismissing a stale modal). Routine retries don't warrant a check-in.
- **Check in at the moment you'd change tack** — routine recovery exhausted and you're about to do something materially different, *especially anything that would reach outside the browser* (backend source, a direct API call, the server, the shell). Announce the impulse before acting on it; that instant — "ordinary moves failed, now I'll get creative" — is exactly where wandering starts.
- Also check in when you're blocked on something only a person plausibly knows (an ambiguous next step, a missing account, a product decision, a CAPTCHA) — same signal; the lead takes it to the user if that's what it needs.
- **Then go idle** — don't busy-loop, don't keep probing, don't act on the "tempted to." The reply wakes you. Apply it (per the reply vocabulary), and re-check the issue is actually resolved before claiming progress. If the same blocker survives a few rounds of guidance, say so — that's cannot-drive.

## 3. Lead side — how to route

A check-in hands you the routing. Decide which fits and reply (the driver is idle, waiting — route promptly):

- **App-knowledge you can answer** (why a control is gated, what feeds a value, an unobvious precondition, a framework quirk) → **first check `forge.md`** — you read it at setup, and its documented gotchas and selectors are the cheapest resolution; if it covers the blocker (a quirk the driver connected to the wrong symptom, a more durable selector), steer with it directly (`try this: <X>`). Only if `forge.md` doesn't cover it, investigate the code: consult `forge.md` for where the source lives (if undocumented, ask the user once, then proceed); `Glob`/`Grep`/`Read` it, or spawn an `Explore` agent for a broad sweep. If it'll take a moment, reply `wait — investigating` first so the driver stays idle, then follow up with the answer. **Read-only research only** — never edit the app, mutate data, or touch the environment.
- **You know the next move** (or the driver's "tempted to" is fine) → `try this: <X>`, or `carry on — go ahead with <their instinct>`.
- **Only the user can answer** (a product decision, a missing account, an intentional gate, a CAPTCHA) → surface via `AskUserQuestion` (built from the check-in; "Other" is always allowed), then relay the user's answer back as a steer.
- **A teaching moment** → a check-in is a natural place to offer the user a walk-through ("want me to walk forge through this part?"); on a yes, nudge collaborativeness up (`team-task.md` Phase 4.0a).

Your routing is the one thing you reach for beyond orchestration, and it's **read-only**. You never drive the browser, write snippets/specs, run specs, or mutate the app or its environment.
