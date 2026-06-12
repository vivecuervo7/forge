# /forge evals

Regression coverage for `/forge` prompt edits, in [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) format.

## Running

These evals are designed to be exercised via `/skill-creator`'s eval runner, which spawns subagents to invoke `/forge` against a known sandbox and asserts on observable outcomes. From a Claude Code session:

```
/skill-creator run the evals for /forge against the sandbox at ~/repos/forge-tests/
```

Skill-creator handles the runner machinery (parallel subagent spawning, baseline comparison, grading, HTML viewer). Don't reinvent it here.

## Fixture assumptions

The sandbox at `~/repos/forge-tests/` is expected to start each iteration in this state:

- **Slots free**: both `slot-standard_user` and `slot-problem_user` have `checkedOutBy: null` in `state.json`. Chromium profile scrubbed (cookies + localStorage + sessionStorage removed) per the `forge-pool-reset.sh` contract.
- **Snippet library populated**: `forge/snippets/` contains `login-as-persona.ts`, `add-item-to-cart.ts`, and `cart-get-badge-count.ts`. No others.
- **Specs present**: `forge/specs/` contains `add-backpack-to-cart-standard.spec.ts` and `persona-isolation.spec.ts`.
- **Videos cleared**: `forge/videos/` is empty.
- **Test-results cleared**: `forge/test-results/` is empty.
- **No `forge-exports/`**: the parent dir does not contain a previous export.

Cases mutate this state during their runs. For repeatable iterations, the runner should snapshot the sandbox before iteration-N and restore it before iteration-(N+1). A snapshot helper isn't included here yet — wire it up when running the full suite for the first time.

## Case design notes

- **Story-arc cases** (1–5) trace the typical user journey: `init` → first drive (novel work) → spec creation → second drive (library reuse) → export.
- **Routing cases** (6–10) protect Phase 0 mode-detection logic. Cases 7 and 8 (`PENDING-PHASE0`) currently FAIL by design — they test the desired natural-language detection for init/export routes, which Phase 0 doesn't yet support. Treating them as the spec for that follow-up work (TDD).
- **Recording-path cases** (11–12) protect the `--record` / `--record-as` surface. Case 11 verifies the word "record" in a drive task doesn't bait the skill into spec mode. Case 12 verifies the default (no-label) recording filename preserves the spec-basename prefix.

## Cost / time

Rough estimate: 12 cases × ~$0.30–$1.50/case (with-skill + without-skill baseline doubles this) = **$5–$40 per full pass**. ~2–4 minutes per case clock time. Not for every commit — run manually on prompt-edit work.

## Adding cases

Append to the `evals` array. Each case needs:

- `id` (next integer)
- `name` (descriptive, kebab-case — used for the workspace subdir)
- `prompt` (what gets passed to `/forge`)
- `expected_output` (human-readable success description)
- `files` (input files — empty for almost all forge cases)
- `expectations` (list of programmatically-verifiable statements)

See `schemas.md` in skill-creator's references directory for the canonical schema.
