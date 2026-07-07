# /forge — team-task spec-mode addendum

This file is loaded by the team-lead **only** when `MODE=spec`. It adds two things to the base `team-task.md`: establishing the spec's **intent** before spawning, and the spec-mode **final-report** shape. Integrate them at the indicated phases.

Spec composition, cold verification, and self-fix all live **inside the `driver`** — it holds the drive's verbatim trace, so the freeze-and-verify loop has no context boundary to cross. The verify loop is the driver's own (it routes snippet-level fixes to the `curator` directly), not lead-orchestrated. Your spec-mode additions are small: decide the intent, thread it into the driver spawn, and report what came back.

Lifecycle is unchanged from drive mode — still **2 tasks, 2 teammates, 2 completion pings**. The only deltas are the intent decision (Phase 2.0) and the report (Phase 5.5).

## Phase 2.0 — Establish the spec intent (before Phase 2.1 / 3)

A forge spec is a re-runnable flow whose assertions each carry an *expected outcome*. It determines what a passing or failing run *means*, so decide it explicitly — never let the driver infer it silently. Every spec is exactly one of:

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

Hold the answer as `SPEC_INTENT`. For a **repro**, also confirm the bug claim — *what correct behavior should hold once the bug is fixed* — so the driver asserts the right thing.

**Ask both in one call, not two rounds.** `AskUserQuestion` takes multiple questions: when repro is among the plausible intents, include a second question in the same call confirming the bug claim — offer your best-inferred claim(s) from `USER_TASK` as options ("Other" covers corrections). One interruption instead of two. When the intent is already unambiguous (e.g. a bug ticket plus "reproduce"), skip the intent question and confirm only the claim — or neither, if the task states the claim outright.

Thread `SPEC_INTENT` (and, for repro, the bug claim) into the driver spawn prompt in `team-task.md` Phase 3.

## Phase 5.5 — Spec-mode final-report shape

Override the base file's drive-mode report with the spec-mode version:

> <driver's final-result one-liner>
>
> Library: curator wrote N new (<names>), patched M (<names>), split K (<names>) — or "no changes — covered by the existing library".
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
> Worth a hint? <only if the driver's ping carried a "Hint worth adding" line — one gentle sentence offering to add it to `forge.md`; never a blocking question. Omit entirely otherwise.>
>
> Next: <one line matched to the verdict — hand the user their next gesture rather than making them remember the command set:>
>   - regression verified → "`/forge run <name>` re-runs it anytime (add `record as <label>` for video evidence); `/forge export <name>` ships it into a test suite."
>   - repro confirmed → "after the fix lands, `/forge run last spec, record as after` shows it green — pair with a `record as before` run now for before/after evidence."
>   - repro came back green → "say the word and I'll promote the soft claim to a hard assertion so it lives on as a regression spec."
>   - scenario → "`/forge run <name>` re-runs the flow anytime."
>   - verified: no → omit the Next line; the failure detail is the next step.
>
> Browser session closed.

If anything didn't go to plan (the spec parked without matching intent, snippet invocation failed mid-drive, etc.), surface prominently — an honest "Verified: no" beats a sanitized success report.
