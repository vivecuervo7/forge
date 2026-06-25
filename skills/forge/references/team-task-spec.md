# /forge — team-task spec-mode addendum

This file is loaded by the team-lead **only** when `MODE=spec`. It adds two things to the base `team-task.md`: establishing the spec's **intent** before spawning, and the spec-mode **final-report** shape. Integrate them at the indicated phases.

In the single-worker design the spec is composed, run cold, and fixed **inside the worker** — it holds the drive's verbatim trace, so the freeze-and-verify loop has no context boundary to cross. There is no separate spec-writer or spec-verifier, and **no lead-orchestrated verify loop**. Your spec-mode additions are therefore small: decide the intent, thread it into the one worker spawn, and report what came back.

Lifecycle is unchanged from drive mode — still **1 task, 1 worker, 1 completion ping**. The only deltas are the intent decision (Phase 2.0) and the report (Phase 5.5).

## Phase 2.0 — Establish the spec intent (before Phase 2.1 / 3)

A forge spec is a re-runnable flow whose assertions each carry an *expected outcome*. It determines what a passing or failing run *means*, so decide it explicitly — never let the worker infer it silently. Every spec is exactly one of:

- **regression** — assert correct behavior with hard `expect(...)`; expected to **pass** (green). Default for "create a spec for X", "write a spec that …".
- **repro** — a red-green bug reproduction: assert the *correct* behavior with `expect.soft(...)` so the spec is honestly **red** against the current build until the bug is fixed. The failure *is* the reproduction — the desired outcome. Signals: a bug ticket, "reproduce …", "write a failing spec for …", "capture the bug where …".
- **scenario** — a runnable flow with **no assertions**, invoked later via `/forge run`. Signals: "a reusable flow to …", "get me to the state where …", "set up …" with no pass/fail claim.

Derive it from `USER_TASK`. **When it's ambiguous, ask the user before spawning** — this is the one place a wrong guess re-creates the green/red thrash:

```
AskUserQuestion({
  question: "Is this spec a regression test (assert correct behavior, expect green), a bug reproduction (assert correct behavior, expect RED until the bug is fixed), or an assertion-less scenario to re-run?",
  header: "Spec intent",
  options: [
    { label: "Bug repro (red)", description: "Asserts the fix's correct behavior; fails now, passes once fixed." },
    { label: "Regression (green)", description: "Asserts correct behavior that already holds; expected to pass." },
    { label: "Scenario (no asserts)", description: "A runnable flow with no pass/fail claim." },
  ]
})
```

Hold the answer as `SPEC_INTENT`. For a **repro**, also confirm the bug claim — *what correct behavior should hold once the bug is fixed* — so the worker asserts the right thing. Thread `SPEC_INTENT` (and, for repro, the bug claim) into the worker spawn prompt in `team-task.md` Phase 3.

## Phase 5.5 — Spec-mode final-report shape

Override the base file's drive-mode report with the spec-mode version:

> <worker's final-result one-liner>
>
> Snippets: wrote N (<names>) — or "none — covered by existing library".
>
> Spec: `<name>.spec.ts` (intent: <regression | repro | scenario>) composing <snippets> and asserting <one-liner>.
>
> Verified: **<verdict>**, matching its <intent> intent:
>   - regression → "**verified green** in <duration>".
>   - repro → "**repro confirmed** — red at the bug claim (`specs/<name>:<line>`) as expected, preconditions green; passes once fixed".
>   - repro that came back green → "**bug appears fixed** — the repro no longer reproduces; promote the soft claim to a hard regression assertion?".
>   - scenario → "**ran clean** (no assertions)".
> (or: "Verified after <N> round(s): <one line on what each round fixed — e.g. 'round 1 found the Size combobox disabled until the options fetch resolved → added a waitFor to the snippet'>".)
> (or: "Did not match intent after <N> round(s) — **verified: no**. <landing-fixes-but-hit-cap | flailing | missing app-knowledge: escalated to user>. See <details>.")
>
> Hint files updated: <one line per file with summary>.
> (Omit this header entirely if no proposals were surfaced or all were rejected.)
>
> Browser session closed.

If anything didn't go to plan (the spec parked without matching intent, snippet invocation failed mid-drive, etc.), surface prominently — an honest "Verified: no" beats a sanitized success report.
