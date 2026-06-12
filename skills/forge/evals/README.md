# /forge evals

Regression coverage for `/forge` prompt edits, in [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) format.

## Three separately-runnable suites

Three files, each a complete skill-creator-format evals JSON. Designed to be run in order — each suite has a distinct purpose and the ordering rationale preserves state across runs.

| File | Suite | Cases | What it tests |
|---|---|---|---|
| `suite-1-routing.json` | **1. Routing decisions** | 19 | Phase 0 / 0a / 0b dispatch — route detection, mode detection, label parsing, false-positive elevations, case-sensitivity |
| `suite-2-happy-path.json` | **2. Full chain happy path** | 1 | End-to-end `/forge spec` against the sandbox in baseline state, idempotent |
| `suite-3-skill-scripts.json` | **3. Skill-routed scripts** | 5 | `/forge run` and `/forge export` — skill-routed but team-less, exercises the recording-on-demand and export-inlining paths |

## Running

`/skill-creator` reads whichever file you point it at. From a Claude Code session:

```
/skill-creator run the evals at plugins/forge/skills/forge/evals/suite-1-routing.json against /forge
```

Repeat with `suite-2-happy-path.json` and `suite-3-skill-scripts.json`. The three suites are independent — running one doesn't depend on running another — but the recommended order is 1 → 2 → 3 because:

- Suite 1 doesn't execute, so it never mutates state.
- Suite 2 is idempotent against the sandbox — it always converges to "3 snippets present" regardless of starting count.
- Suite 3 may add files to `forge/videos/` and `<project>/forge-exports/` but doesn't touch snippets or specs.

Re-runs across iterations don't require a sandbox reset. The suites are repeatable.

## Suite 1 — Routing decisions (19 cases, fully parallel)

Pure stateless tests. Each subagent reads `SKILL.md`, applies Phase 0 / 0a / 0b to a given user prompt, and outputs a JSON object describing the routing decision. **No execution happens** — no `/forge` teammate is spawned, no script is invoked, no sandbox state is touched.

Safe to parallelise. Cheap (~$0.05/case at low temperature).

Catches: Phase 0 dispatch regressions, mode-detection drift (drive vs spec), label-parsing drift (RECORD_AS extraction), false-positive elevations (e.g. "record" or "spec" mentioned incidentally), case-sensitivity issues.

Three cases marked **PENDING** in `expected_output` (numbers 2, 3, and 6) — they test desired natural-language detection for init/export routes which Phase 0 doesn't yet support. They fail today by design; will turn green when Phase 0 is expanded. TDD spec for that follow-up.

## Suite 2 — Full chain happy path (1 case, serial)

One end-to-end execution against the sandbox. Spec mode runs the full team: driver, snippet-author, spec-writer, spec-verifier.

Designed to be **idempotent**: convergent on 3 snippets at end regardless of starting count. The sandbox can be in baseline state (3 snippets) or even empty (0 snippets) — either way, after this case runs, 3 snippets exist with semantically-correct names.

Catches: full team mechanism regressions, library-reuse discipline, spec verification end-to-end, slot lifecycle.

## Suite 3 — Skill-routed scripts (5 cases, parallel)

Skill-routed cases that exercise the team-less paths: `/forge run` (verification-only, labeled-recording, last-resolution) and `/forge export` (default output, --output override).

Safe to parallelise. No slot claim happens — Playwright uses an ephemeral browser; credentials come from `forge/.env`.

Catches: `/forge run` route behavior, `/forge export` route behavior, recording filename convention.

## What's deliberately NOT in the suites

State-sensitive checks are documented in the project conventions / manual testing rather than the evals. Specifically:

- **Snippet authoring discipline.** Does snippet-author actually write per-step snippets when the work is novel? Verify by running a drive against a sandbox where the library doesn't cover the task.
- **Library reuse discipline.** Does driver invoke existing snippets instead of re-driving? Verify by running a drive against a covered task and watching the driver's narration for `invoked X` vs `drove fresh: X`.
- **Spec-writer skip-when-match.** Does spec-writer correctly skip composition when an exact-match spec is already in `forge/specs/`?

These checks would fail differently depending on what was already in the sandbox before the case ran. That makes them state-sensitive — better as human-eyeballed manual checks than automated regressions.

## Adding cases

To add a case to one of the suites, append to the `evals` array of the relevant file. Each case needs:

- `id` (next integer within that file — IDs are unique per file, not across files)
- `name` (descriptive, kebab-case, prefixed with `s1-` / `s2-` / `s3-` to keep the suite visible in the case name)
- `prompt` (for Suite 1: the routing-wrapper instruction with the user's prompt embedded; for Suite 2 & 3: the user's actual `/forge` invocation)
- `expected_output` (human-readable success description; flag `PENDING` if the case is TDD-style and currently fails)
- `files` (input files — empty for almost all forge cases)
- `expectations` (list of programmatically-verifiable statements)

When in doubt about whether a check belongs in evals or in manual testing: if the assertion would behave differently depending on what was already in the sandbox before this case ran, it's state-sensitive — move it to manual testing.

See `schemas.md` in skill-creator's references directory for the canonical schema.
