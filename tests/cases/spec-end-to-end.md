# Case: spec-end-to-end

**Type**: runbook (manual until headless `/forge` invocation is wired up)

**What it tests**: spec mode produces a runnable spec file, the spec-verifier passes it from a cold start, and the recording lands in `forge/videos/` with the expected naming convention.

## Setup

```bash
cd ~/repos/forge-tests

source ~/repos/claude-plugins/plugins/forge/tests/lib/sandbox.sh
sandbox_full_reset

# Note the current spec count + video count
ls forge/specs/*.spec.ts 2>/dev/null | wc -l
ls forge/videos/*.webm 2>/dev/null | wc -l
```

## Invoke

In Claude Code, from `~/repos/forge-tests/`:

```
/forge spec add the backpack to the cart and verify badge count is 1
```

Optionally, with a label:

```
/forge spec add the backpack to the cart and verify badge count is 1, record as before
```

## Assertions

After the team reports completion:

1. **Spec file created**. A new `.spec.ts` exists under `forge/specs/`. (Or an existing one was updated in place — final report distinguishes these.)
2. **Spec contains no literal credentials**. Run:
   ```bash
   grep -E "secret_sauce|standard_user|problem_user" forge/specs/*.spec.ts
   ```
   This should find nothing. Credentials should be `process.env.SAUCE_USERNAME` / `process.env.SAUCE_PASSWORD`.
3. **Spec composes existing snippets**. Run:
   ```bash
   grep -E "from '../snippets/" forge/specs/*.spec.ts
   ```
   At least one import line should appear, referencing snippets that cover the step (e.g. `login-as-persona`, `add-item-to-cart`, `cart-get-badge-count`).
4. **Spec-verifier passed**. Final report says "passed in <duration>" not "FAILED after N iterations."
5. **Video persisted**. `forge/videos/<spec-basename>-<suffix>.webm` exists. Suffix is either the label (if `record as <label>` was in the task) or a `YYYYMMDD-HHMMSS` timestamp.
6. **Video has real content**. File size > 10KB. (Empty videos suggest the recording failed silently.)
7. **Slot released cleanly**. `forge/.pool/slot-*/state.json` shows `checkedOutBy: null` for all slots.

## Failure modes this catches

- Spec mode silently degrading to drive mode (no spec file produced).
- Credential leak — spec inlining `secret_sauce` instead of `process.env.SAUCE_PASSWORD`.
- Snippet inlining — spec writing out the body of an existing snippet instead of importing it.
- Recording bypass — `--record` not threaded through, no video produced.
- Verifier rubber-stamping — claiming pass when the spec actually failed.

## Notes

Assertions 2-3 are the most prompt-sensitive — they catch regressions where the spec-writer agent's instructions weaken. Assertion 5 catches script-level regressions in the recording-persistence path. Assertion 7 catches lifecycle regressions in the team lead.
