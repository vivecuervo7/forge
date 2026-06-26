# Agent — escalation protocol

This reference is loaded on-demand by any agent (driver, snippet-author, others) that has exhausted self-recovery and needs to escalate. It's not pre-loaded — agents only `cat` it when a blocker has been recognized.

The agent's base prompt is responsible for **recognition** (deciding it's blocked); this reference covers **handling** — which way up to take, what to send, and how to apply the reply. There are **two upward channels**:

- **investigate** — the blocker is *app-knowledge you can't see from the browser* (what gates a control, what feeds a value, an unobvious precondition). The **lead** can read it out of the source/config and answer you.
- **STUCK** — the blocker needs a *user* decision (ambiguous intent, a missing account, a product call, CAPTCHA).

Prefer **investigate** when the answer lives in the code — it keeps the user out of the loop until a real decision needs them, and it's the move to make instead of reaching outside the browser yourself.

## When to load this

Load when you've recognized a blocker that your own ~5 cheap recovery moves (different selectors, waits, re-orientation, modal dismissal) didn't clear. Then pick the channel:

**Investigate** (the lead can answer from the code):

- A control stays gated, a value won't populate, a flow silently needs a precondition — and you can't tell *why* from the UI
- Anything you'd otherwise reach behind the browser to learn (an endpoint, a backend rule, a data dependency)

**STUCK** (only the user can answer):

- An ambiguous next step where only the user can decide ("which of these 3 Export buttons do you mean?")
- An unexpected UI state requiring manual intervention (CAPTCHA, MFA, unknown error dialog)
- Credentials or business decisions you can't infer from hints
- A naming-convention conflict (snippet-author) the project hint doesn't resolve

Cap of 5 escalations per task across both channels. Past that, escalate to cannot-drive (below).

## How to investigate — hand the question up to the lead

When the blocker is something you'd otherwise have to look *behind the browser* to answer — the source, the API, the data layer — hand it to the lead instead of reaching there yourself. The lead reads the code and answers.

```
SendMessage(
  to="team-lead",
  summary="investigate: <tight one-line of what you need to understand>",
  message="INVESTIGATE

QUESTION: <what you need to know about how the app works — e.g. 'what gates the Size dropdown? it stays disabled after I pick a colour'>

OBSERVED: <the UI state, the selectors you saw, what you tried, what didn't change>
"
)
```

The lead replies `investigate_response — <answer>` once it's read the relevant code; apply it and resume. If its investigation turns up that the call is actually the user's to make, it comes back as a `stuck_response` instead — same as STUCK. Either way, **go idle** while you wait; the reply wakes you.

## How to STUCK

SendMessage's `message` field is a plain string (not a JSON object). Use this plain-text format so the lead can parse you reliably — and so future-you reading messages mid-debug doesn't have to decode escaped JSON:

```
SendMessage(
  to="team-lead",
  summary="STUCK: <tight one-line reason>",
  message="STUCK

QUESTION: <plain-language question for the user>

CONTEXT: <what you tried, what happened, what you observe right now>

OPTIONS:
- <short label 1> | value: <value 1>
- <short label 2> | value: <value 2>
"
)
```

The `OPTIONS:` section is OPTIONAL — include it when there's a discrete set of choices (selectors, IDs, named modes). Omit the whole `OPTIONS:` section for free-form answers. The lead surfaces via `AskUserQuestion` (which always includes an "Other" path for free-form replies regardless), then SendMessages you back with the user's choice.

While waiting, **go idle**. Don't busy-loop, don't probe more selectors, don't keep snapshotting. The lead's reply will wake you.

## Applying the answer

An `investigate_response — <answer>` carries what the lead learned from the code; apply it and resume. A `stuck_response` (whether you sent STUCK, or the lead converted your investigate into a user question) arrives as a plain-text message with a body like `stuck_response — answer: <chosen-value-or-free-text>`. Parse the answer out of the body, apply it, continue the work. Use the user's answer literally if it's a selector/value; interpret naturally if it's free-form. Re-check whether the issue is actually resolved before claiming progress.

## Cannot-drive — terminal failure

Reserved for: work genuinely cannot continue, the user's answer didn't resolve the issue after multiple STUCK rounds, or the task as specified is impossible in the current state.

```
SendMessage(
  to="team-lead",
  summary="cannot-drive: <reason>",
  message="<full context: what was tried, what failed, why escalation didn't help>"
)
```

Then `TaskUpdate(taskId=<id>, status="completed")` (your work is done — outcome was cannot-drive, but the task as defined is finished). The lead surfaces the failure as part of the final report.
