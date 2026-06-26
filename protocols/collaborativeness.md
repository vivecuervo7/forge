# Collaborativeness — the human-in-the-loop dial

`COLLABORATIVENESS` is a run-level setting: one of an **ordered set of named levels**, lowest to highest —

`autonomous` (default) → `light-touch` → `guided` → `step-by-step`

It expresses one thing: **how readily the lead brings the user into the loop.** The driver's *cadence* — how often it surfaces — is **derived** from the level, not set separately.

It's a small ladder of detents, not a continuous scale — the value is always one of these four names. Nobody sets it as a number: the router derives the level from the user's language, and the lead steps it up or down a rung on the user's cue.

## The floor (constant at every level)

Underneath the whole ladder sits a floor that never moves: **a genuinely-stuck lead always pauses and asks the user** rather than guessing — even at `autonomous`. This mirrors the driver, which checks in with the lead when *it's* stuck (`escalation.md`). Neither improvises past its own competence. Collaborativeness only governs how far *above* that floor the lead reaches for the user — how much it involves them in things it *could* have resolved itself.

## The levels

| level | lead deference (how readily it asks the user) | driver cadence (derived) |
|---|---|---|
| **autonomous** *(default)* | resolves everything it can itself; asks only when *it* is stuck (the floor) | reactive — surface only at the stuck / change-tack check-in |
| **light-touch** | also surfaces genuine forks, even ones it could've resolved | reactive *(identical to autonomous)* |
| **guided** | routes most non-trivial calls to the user | elevating — driver surfaces meaningful chunks proactively, not only when stuck |
| **step-by-step** | ~everything goes to the user | per-step — driver surfaces each step before acting (teaching lockstep) |

The shape that matters: **deference rises rung by rung; cadence holds at its reactive default through `autonomous` and `light-touch`, and ramps to per-step only at `guided` → `step-by-step`.** Step-by-step interactiveness is the top rung, not a separate knob. `light-touch` is the common "run free, but consult me on the real forks" posture — reactive cadence, raised deference.

## Who reads what

- **Router** (`SKILL.md`) sets the initial level from the user's language: the teach route → `step-by-step`; a task framed "walk me through" / "I'll show you" → `guided`; otherwise `autonomous`.
- **Lead** (`team-task.md`) reads the **deference** column — it biases how readily each check-in is routed to the user (`escalation.md` §3), and at `guided`/`step-by-step` makes the lead an active interlocutor (`team-task.md` Phase 4.0a). The lead **holds the level and steps it mid-run** on the user's framing: "walk me through this next bit" → up a rung; "you can take it from here" → back to `autonomous`.
- **Driver** (`driver-worker.md`) reads the **cadence** column — at `autonomous` it surfaces only via the reactive check-in; the higher the level, the more proactively it surfaces, up to per-step at `step-by-step`.
