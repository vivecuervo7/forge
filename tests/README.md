# forge evals

Behavioral tests for the forge plugin. Each case asserts on **observable outcomes** (exit codes, files produced, mode decisions) rather than snapshot-matching the non-deterministic prompt output of the agents.

## Running

```bash
./run.sh                  # run all automated cases
./run.sh mode-detection   # run a single case
```

`ANTHROPIC_API_KEY` must be set in env for cases that invoke the API directly. Cases that don't need the API (filesystem assertions, script unit tests) run without credentials.

## Cases

| Case | Type | What it tests |
|---|---|---|
| `mode-detection` | automated (API) | Phase 0 picks the correct mode for a matrix of input phrasings — explicit `spec` keyword, natural-language signals, incidental "spec" mentions that shouldn't trigger. |
| `drive-with-library` | runbook | Driver invokes existing snippets rather than re-driving them; snippet-author writes 0 new files when the library covers everything. |
| `spec-end-to-end` | runbook | Spec mode produces a runnable spec file, the verifier passes from cold start, and a video file lands in `forge/videos/`. |

Runbook cases are step-by-step manual procedures with explicit assertions to check. They become automated when there's a stable mechanism to drive `/forge` headlessly against the sandbox.

## Sandbox

All cases run against `~/repos/forge-tests/` — saucedemo-backed, two slots provisioned (`slot-standard_user`, `slot-problem_user`), existing snippets for login + add-to-cart + cart-badge.

`lib/sandbox.sh` provides helpers to reset slots to a known state before each case.

## Adding a case

For automated:

1. Create `cases/<name>.sh`. Make it executable.
2. Use helpers from `lib/`. Exit 0 on pass, non-zero on fail.
3. Add it to `run.sh`'s case list.

For runbook:

1. Create `cases/<name>.md`. Document setup, invocation, and assertions to check.
2. Add a one-liner to `run.sh` that prints "manual case — see cases/<name>.md."

## Cost

Mode-detection runs Claude Sonnet at low temperature with short outputs — roughly $0.01-$0.03 per full pass. Runbook cases are uncapped (the user is invoking `/forge` interactively). Don't run automated cases in tight loops.
