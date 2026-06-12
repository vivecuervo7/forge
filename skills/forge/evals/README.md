# /forge evals

Regression coverage for `/forge` prompt edits, in [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) format.

## Three suites, distinct purposes

The 25 cases in `evals.json` are organised by `s1-` / `s2-` / `s3-` name prefix and intended to be run as **three logical suites in order**. Skill-creator's runner doesn't natively understand suite separation, so the convention lives in the case names and is documented here.

### Suite 1 — Routing decisions (cases `s1-*`, 19 cases)

Pure stateless tests. Each subagent reads `SKILL.md`, applies Phase 0 / 0a / 0b to a given user prompt, and outputs a JSON object describing the routing decision. **No execution happens** — no /forge teammate is spawned, no script is invoked, no sandbox state is touched.

Safe to parallelise. Cheap (~$0.05/case at low temperature). Re-runs in isolation; no fixture setup needed.

Catches: Phase 0 dispatch regressions (route detection), Phase 0a mode-detection drift (drive vs spec), Phase 0b label-parsing drift (RECORD_AS extraction), case-sensitivity issues, false-positive elevations (e.g. "record" or "spec" in incidental context).

Cases 2, 3, and 6 are marked **PENDING** in their `expected_output` — they test desired natural-language detection for init/export routes, which Phase 0 doesn't yet support. They fail today by design; will turn green when Phase 0 is expanded. TDD spec for that follow-up.

### Suite 2 — Full chain happy path (case `s2-*`, 1 case)

One end-to-end execution against the sandbox in baseline state. Spec mode runs the full team — driver invokes existing snippets, snippet-author writes (or doesn't, if covered), spec-writer composes (or updates), spec-verifier confirms pass from cold start.

Designed to be **idempotent**: convergent on 3 snippets at end regardless of starting count. Sandbox can be in baseline state (3 snippets) or even empty (0 snippets) — either way, after this case runs, 3 snippets exist with semantically-correct names. Re-running is safe.

Catches: full team mechanism regressions, library-reuse discipline, spec verification end-to-end, slot lifecycle.

### Suite 3 — Skill-routed scripts (cases `s3-*`, 5 cases)

Skill-routed cases that exercise the script-bound paths (run, export) without spawning a team. The user-facing surface IS `/forge`, but these routes are team-less by design — they invoke `forge-pool-run-spec.mjs` and `forge-export-spec.mjs` directly.

Safe to parallelise. No slot claim happens (the runner uses Playwright's ephemeral browser; credentials come from `forge/.env`).

Catches: `/forge run` route behavior (verification-only, labeled recording, `last` resolution), `/forge export` route behavior (default output path, override), and the recording filename convention.

### Ordering

Cases within a suite are independent. Between suites, the recommended order is **1 → 2 → 3** because:

- Suite 1 doesn't execute, so it never mutates state.
- Suite 2 is idempotent against the sandbox — it always converges to "3 snippets present" regardless of start.
- Suite 3 may add files to `forge/videos/` and `<project>/forge-exports/` but doesn't touch snippets or specs.

Re-runs across iterations don't require a sandbox reset. The suite is genuinely repeatable.

## Running

Exercise via `/skill-creator`'s eval runner. From a Claude Code session:

```
/skill-creator run the evals for /forge against the sandbox at ~/repos/forge-tests/
```

Skill-creator handles the runner machinery (subagent spawning, baseline comparison, grading, HTML viewer). To filter by suite, you can manually invoke specific case names.

## Adding cases

Append to the `evals` array. Each case needs:

- `id` (next integer)
- `name` (descriptive, kebab-case, prefixed with `s1-` / `s2-` / `s3-`)
- `prompt` (for Suite 1: the routing-wrapper instruction with the user's prompt embedded; for Suite 2 & 3: the user's actual `/forge` invocation)
- `expected_output` (human-readable success description; flag `PENDING` if the case is TDD-style and currently fails)
- `files` (input files — empty for almost all forge cases)
- `expectations` (list of programmatically-verifiable statements)

When in doubt about whether a check belongs in evals or in manual testing: if the assertion would fail differently depending on what was already in the sandbox before this case ran, it's state-sensitive — move it to manual testing.

See `schemas.md` in skill-creator's references directory for the canonical schema.
