# Agent — STUCK protocol

This reference is loaded on-demand by any agent (driver, snippet-author, others) that has exhausted self-recovery and needs to escalate. It's not pre-loaded — agents only `cat` it when a STUCK condition has been recognized.

The agent's base prompt is responsible for **recognition** (deciding "I'm stuck"). This reference covers **handling** (how to escalate, what to send, how to apply the user's answer).

## When to load this

Load when you've recognized a STUCK condition:

- ~5 in-task recovery attempts past the first failure have all failed (different selectors, waits, re-orientation, modal dismissal — exhausted)
- An ambiguous next step where only the user can decide ("which of these 3 Export buttons do you mean?")
- An unexpected UI state requiring manual intervention (CAPTCHA, MFA, unknown error dialog)
- Credentials or business decisions you can't infer from hints
- A naming-convention conflict (snippet-author) the project hint doesn't resolve
- Cap of 5 STUCK escalations per task. Past that, escalate to cannot-drive (below).

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

The lead's reply arrives as a plain-text message with summary `stuck_response` and a body like `stuck_response — answer: <chosen-value-or-free-text>`. Parse the answer out of the body, apply it, continue the work. Use the user's answer literally if it's a selector/value; interpret naturally if it's free-form. Re-check whether the issue is actually resolved before claiming progress.

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
