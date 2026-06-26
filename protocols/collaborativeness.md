# Collaborativeness — the human-in-the-loop dial

`COLLABORATIVENESS` is a run-level dial, `0.0`–`1.0`, default **0.0**. It expresses one thing: **how readily the lead brings the user into the loop.** The driver's *cadence* — how often it surfaces — is **derived** from the dial, not set separately.

It's an interface, not a number the agents do arithmetic on: read the **nearest anchor** and behave to its definition; for in-between values, lean toward the nearer anchor.

## The floor (constant at every setting)

Underneath the whole dial sits a floor that never moves: **a genuinely-stuck lead always pauses and asks the user** rather than guessing — even at `0.0`. This mirrors the driver, which checks in with the lead when *it's* stuck (`escalation.md`). Neither improvises past its own competence. Collaborativeness only governs how far *above* that floor the lead reaches for the user — how much it involves them in things it *could* have resolved itself.

## The anchors

| value | lead deference (how readily it asks the user) | driver cadence (derived) |
|---|---|---|
| **0.0** autonomous *(default)* | resolves everything it can itself; asks only when *it* is stuck (the floor) | reactive — surface only at the stuck / change-tack check-in |
| **~0.3** light-touch | also surfaces genuine forks, even ones it could've resolved | reactive *(identical to 0.0)* |
| **~0.7** guided | routes most non-trivial calls to the user | elevating — driver surfaces meaningful chunks proactively, not only when stuck |
| **1.0** step-by-step | ~everything goes to the user | per-step — driver surfaces each step before acting (teaching lockstep) |

The shape that matters: **deference rises across the whole range; cadence holds at its reactive default through the low and mid, and ramps to per-step only near the top.** Step-by-step interactiveness is an emergent property of full-blast collaborativeness, not a separate knob. The mid of the dial is the common "run free, but consult me on the real forks" posture — reactive cadence, raised deference.

## Who reads what

- **Router** (`SKILL.md`) sets the initial value: the teach route → `1.0`; a task framed "walk me through" / "I'll show you" → high; otherwise `0.0`.
- **Lead** (`team-task.md`) reads the **deference** column — it biases how readily each check-in is routed to the user (`escalation.md` §3), and at high values makes the lead an active interlocutor (`team-task.md` Phase 4.0a). The lead **holds the dial and nudges it mid-run** on the user's framing: "walk me through this next bit" → up; "you can take it from here" → back toward `0.0`.
- **Driver** (`driver-worker.md`) reads the **cadence** column — at `0.0` it surfaces only via the reactive check-in; as the value climbs it surfaces proactively, up to per-step at `1.0`.
