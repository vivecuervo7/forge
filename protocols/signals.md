# Signals — the team's coordination vocabulary

The routine signals the team passes during a run, gathered in one place. This is the shared **glossary** — the canonical name, direction, meaning, and message shape of each — so the driver, the curator, and the lead all use the same words. It **complements** the inline choreography rather than replacing it: each agent's phases describe *when* and *why* it sends or waits on a signal, in its own narrative; this table is the at-a-glance reference those phases share, and the canonical source if a shape is ever in doubt.

One coordination channel has its own protocol file and isn't repeated here:

- **check-ins** (driver → lead, when stuck or changing tack) → `escalation.md`

## Peer signals — driver ↔ curator (direct, async)

| signal | direction | meaning | shape |
|---|---|---|---|
| `chunk complete` | driver → curator | a meaningful chunk is done — read my trace and curate it | `summary="chunk complete: <intent>"` · `message="<invoked X \| drove fresh: …> · <bypass reason?> · <taught gotcha?> · Look at my trace."` |
| `drive complete` | driver → curator | no more chunks — wrap up authoring | `summary="drive complete"` · `message="No more chunks. Wrap up authoring and ping team-lead."` |
| `snippets-ready` | curator → driver | the library reflects this drive — safe to compose the spec | `summary="snippets-ready"` · `message="Library updated. Wrote/patched: <names>. INDEX regenerated."` |
| `patch-request` | driver → curator | a composed snippet failed cold — patch it | `summary="patch-request: <snippet>"` · `message="<snippet> failed at specs/<name>:<line>: <error>. <cause>. Patch it."` |
| `patched` | curator → driver | snippet fixed — re-run | `summary="patched: <snippet>"` · `message="Patched <snippet>: <what changed>. INDEX regenerated. Re-run."` |
| `run resolved` | driver → curator | verify loop is over — no more patch-requests, you can complete | `summary="run resolved"` · `message="Verify loop done (<verified \| parked>). No more patch-requests — send team-lead your completion ping."` |

Fire-and-forget and async, with two sync points: the driver waits on `snippets-ready` before composing (spec mode) and on `patched` before re-running. **The trace is the source of truth** — a missed or dropped signal never loses work; the curator can always recover by reading the driver's transcript forward.

## Lifecycle signals — lead ↔ teammate

| signal | direction | meaning | shape |
|---|---|---|---|
| completion ping | teammate → lead | my task is done — here's the result | `summary="<role> task complete"` · `message="… <driver only: optional 'Hint worth adding: …' line>. Going idle."` |
| `shutdown_request` | lead → teammate | team work is done — stand down | `message={"type":"shutdown_request","reason":"…"}` |
| `shutdown_response` | teammate → lead | acknowledged | `{"type":"shutdown_response","request_id":<id>,"approve":true}` (carries `paneId` under tmux) |

The lead waits for **both** completion pings before shutting anyone down; the curator stays alive through the driver's verify loop and completes on `run resolved`. Mid-run **steering** and **user-relay** (lead → teammate) are free-form, not fixed signals.
