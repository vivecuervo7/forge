# /forge evals

Regression coverage for `/forge` prompt edits, in [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) format.

## Design principle: routing-focused

These evals check **decisions**, not **artifacts**. Each case asserts on:

- Which route Phase 0 selected (init / export / spec / drive)
- Which references the lead loaded
- Which subagents got spawned
- Which flags propagated through to script invocations

They do **not** assert on what got written to disk, whether snippets accreted, or whether the spec-verifier passed from cold start. Those outcomes depend on what's already in the sandbox (existing snippets, prior specs, etc.) — they're state-sensitive in ways that make repeatable evals brittle. We leave them to manual testing where state can be controlled by hand.

Where an invariant artifact check is safe to include (e.g. "if a spec file is produced, it doesn't contain literal credentials"), the expectation is conditional — it only fires when the artifact exists, so the case stays stateless.

## Running

Exercise via `/skill-creator`'s eval runner. From a Claude Code session:

```
/skill-creator run the evals for /forge against the sandbox at ~/repos/forge-tests/
```

Skill-creator handles the runner machinery (subagent spawning, baseline comparison, grading, HTML viewer). Don't reinvent it here.

Because each case is routing-focused and stateless, cases can run in parallel safely. No fixture reset script is required between cases or between iterations.

## Cases

| # | Name | What's tested |
|---|---|---|
| 1 | `route-init-keyword` | `/forge init` → init route detected; `init.md` loaded; `forge-init.sh` invoked |
| 2 | `route-init-natural-PENDING-PHASE0` | `/forge install forge here` → init via natural language *(currently fails)* |
| 3 | `route-export-keyword` | `/forge export <name>` → export route; `export.md` loaded; `forge-export-spec.mjs` invoked; if a file was produced it inlines snippets |
| 4 | `route-export-natural-PENDING-PHASE0` | `/forge export the spec from latest recording` → export via natural language *(currently fails)* |
| 5 | `mode-spec-keyword` | `/forge spec <task>` → spec mode; 4 teammates spawned; no literal credentials in any spec produced |
| 6 | `mode-spec-natural` | `/forge create a spec for...` → spec mode via natural language; same downstream as case 5 |
| 7 | `mode-drive-default` | Bare drive task → drive mode; exactly 2 teammates; no spec-writer or spec-verifier |
| 8 | `mode-drive-incidental-spec` | Task with negated "spec" mention → drive mode (no false-positive elevation) |
| 9 | `mode-drive-record-keyword` | Task with colloquial "record" mention → drive mode; no `--record` flag reaches any script |
| 10 | `record-as-label-capture` | `/forge spec X, record as before` → RECORD_AS=before captured; `--record-as before` reaches the spec runner |

Cases 2 and 4 are marked `PENDING-PHASE0`. They test desired natural-language detection for init/export routes, which `SKILL.md`'s Phase 0 doesn't yet support. They serve as TDD-style spec for the follow-up Phase 0 expansion commit — they fail today, turn green when Phase 0 is expanded.

## What moves to manual testing

The evals deliberately don't cover these — they're state-sensitive enough that automating them produces more false alarms than real signal. Run them by hand against the sandbox when prompt edits touch the relevant agents:

- **Snippet authoring discipline.** Does snippet-author actually write per-step snippets when the work is novel? Verify by running a drive against a sandbox where the library doesn't cover the task, then inspecting `forge/snippets/` afterward.
- **Library reuse discipline.** Does driver invoke existing snippets instead of re-driving? Verify by running a drive against a sandbox where the library covers the task and watching the driver's narration for `invoked X` vs `drove fresh: X`.
- **Spec-writer skip when matching spec exists.** Does spec-writer correctly skip composition when an exact-match spec is already in `forge/specs/`? Verify by running spec mode twice on the same task.
- **Spec-verifier passes from cold start.** Does the produced spec actually pass when run fresh? Verify by inspecting the spec file and the verifier's pass/fail report.
- **Recording filename convention.** Does the persisted video preserve the spec-basename prefix? Does labeled vs default naming work correctly? Verify by inspecting `forge/videos/` after spec mode runs with and without `record as <label>`.

## Cost / time

Routing-focused cases short-circuit relatively fast — most don't need a full drive to completion. Rough estimate: 10 cases × ~$0.20–$1.00/case (with baseline doubles this) = **$4–$20 per full pass**. ~1–3 minutes per case clock time.

## Adding cases

Append to the `evals` array. Each case needs:

- `id` (next integer)
- `name` (descriptive, kebab-case — used for the workspace subdir)
- `prompt` (what gets passed to `/forge`)
- `expected_output` (human-readable success description)
- `files` (input files — empty for almost all forge cases)
- `expectations` (list of programmatically-verifiable statements)

Stay in the routing/invariant lane. If you find yourself wanting to assert on "N new files appeared" or "the spec passed verification," that's a signal the case belongs in the manual checklist above.

See `schemas.md` in skill-creator's references directory for the canonical schema.
