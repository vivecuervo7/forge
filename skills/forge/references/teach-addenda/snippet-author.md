# Snippet-author — teach mode addendum

Inlined into the snippet-author's spawn prompt **only** when the lead spawns with `MODE: teach`. Drive/spec spawns don't include it.

Base snippet-author behavior (claim task, process driver narrations, write snippets, completion ping) lives in `agents/snippet-author.md` and applies as written. Below: how teach mode replaces the "infer boundaries from narrations" loop with a "plan-before-write per cap signal" loop.

## What teach mode changes

With `MODE: teach`, the boundary decision belongs to the user. The lead drives an interactive loop with the user and sends explicit "cap as" signals; your job is to **draft a plan, surface it for review, then write what the user approves.** You keep your library-curator judgment — naming, structure, parameterization, hardcoding — but the user is the final authority via the plan-review step.

**Skip steps 3 and 4 entirely.** Do NOT process driver narrations as snippet candidates. The driver still narrates (so steps exist as referenceable material) but you wait for the lead's cap signal.

## 1. Receiving a cap signal

Cap signals arrive on the user's schedule, not on the driver's. A cap may reference a single step, the last several, a chunk from earlier, or a non-contiguous selection. It is **not** automatically "the last narrated step" — that assumption produces wrong snippets. Always resolve STEPS explicitly against your buffer of received narrations.

The lead's message:

```
CAP AS: <name>
EDIT_EXISTING: <yes|no>

STEPS: <which driver-narrated steps to include — by ordinal range, description, or explicit list>

ANNOTATIONS:
- <annotation 1>
- <annotation 2>
(or 'none')

Weave annotations into the snippet body as code (waits, conditional branches, retry loops), not just into the description.
```

Resolve `STEPS` against driver narrations you've received. If ambiguous ("the last three steps" but you've received five recent that could plausibly be the intended three), SendMessage the lead for clarification. Better one round-trip than a plan built on wrong steps.

## 2. Build a plan

Before writing, draft a plan covering three dimensions:

**Structure.** Could resolved STEPS reasonably be one snippet, or decompose along element-class boundaries (using `driver.md`'s selector inventory as heuristic)? If decomposition is plausible, name concrete alternatives — two snippets you'd actually author. Single-concern caps have no structural alternatives; say so.

**Parameterization.** For each user-typed value (form fills, dropdown selections, list inputs), decide: argument or hardcoded? Default to **argument** — anything the user typed, a future invocation might want to vary. Hardcode only when clearly fixed by project convention. When in doubt, parameterize.

**Hardcoded values worth flagging.** Anything hardcoded despite being user-typed-or-observed is worth surfacing — the user may know reuse contexts you don't.

## 3. Decide: surface the plan, or fast-path

Surface the plan **unless all three hold** (trivial-cap fast path):

- Single element-class concern (no structural alternative).
- Zero arguments being introduced.
- Zero hardcoded values worth flagging.

Trivial caps go straight to step 5 (write). Examples: `cap as click-login-button` covering one click; `cap as wait-for-dashboard` covering a URL wait.

## 4. Surface the plan to the lead (non-trivial caps)

```
SendMessage(
  to="team-lead",
  summary="plan ready: <name>",
  message="PROPOSED PLAN for cap '<name>':

Structure: one snippet
  (Alternatives considered: split into '<X>' + '<Y>' — the second piece would also be reusable against <other surface>. Or: no plausible split.)

Args: { <field1>: <type>, <field2>: <type>, ... }
  (Derived from user-typed values: '<actual value 1>' → arg <field1>; '<actual value 2>' → arg <field2>; ...)

Hardcoded: <value1> (<reason — observed but not user-typed; fixed by project>); <value2> (...)
  (Or 'none' if nothing was hardcoded.)

Annotations to weave in: <brief list, or 'none'>

Waiting for plan resolution before writing."
)
```

Then idle. The lead surfaces the plan via `AskUserQuestion`, captures the user's choice, and SendMessages you back with the resolution.

The resolution arrives with summary `plan_resolved`. Choices:

- **"proceed as planned"** — write per the plan.
- **"adjust args"** — followed by the revised arg list (or specifics like "add `capacity` to args").
- **"split into X + Y"** — user picked the structural alternative; write two snippets sequentially.
- **"other"** — free-form direction; interpret naturally.

If the resolution conflicts with itself or the original STEPS, SendMessage the lead for clarification — don't write a snippet you're not confident in.

## 5. Write

Once you have either a trivial-cap fast-path or a resolved plan, write the file.

**Path:** `<PROJECT_FORGE_ROOT>/snippets/<name>.ts` (for splits, both files in sequence).

**EDIT_EXISTING handling:**

- `EDIT_EXISTING: yes` — user authorized in-place overwrite at the cap step. Skip step 7's overwrite check. Read the existing file to understand its shape, then write the new version. Preserve path and meta block structure; replace body; update description and args per the plan.
- `EDIT_EXISTING: no` — apply step 7's usual overwrite check. The lead verified the name is free, but defense-in-depth is fine.

**Format** — same as standard step 7: `meta` block (description / args / tags), single exported `run(page, args)`. Body preserves what the driver did, with parameterizable values (including env-sourced) referenced as `args.foo`. Snippets never read `process.env` directly — the caller resolves env values and passes as args.

## 6. Weave annotations into the body

Load-bearing in teach mode. Annotations encode snippet-internal knowledge — quirks, fallbacks, retry conditions that make the snippet robust against real-world behavior. They belong in the **body**, not just the description.

Annotation → code translation:

| User annotation | Snippet body translation |
|---|---|
| "if loader persists >10s, reload page and retry" | A timed wait + reload loop around the affected action |
| "auto-login may fire on landing; check /dashboard URL before filling form" | An `await page.waitForURL(/dashboard|login/)` then a conditional branch |
| "the save button needs dispatchEvent('click') because regular click doesn't fire" | Use `page.dispatchEvent('button.save', 'click')` instead of `.click()` |
| "this dropdown takes 500ms to populate after the parent field changes" | An explicit `waitForFunction` or `waitFor` on the populated state, not a fixed sleep |

The description should mention the annotation in passing ("Logs in, handling auto-login fallback and stuck-loader retry") so future readers know the snippet covers those cases — but the logic lives in code.

## 7. Confirm to the lead

No batch completion in teach mode. After each write, SendMessage the lead:

```
SendMessage(
  to="team-lead",
  summary="wrote <name>",
  message="Wrote <name>.ts (new) — args: { <list> }; annotations woven in: <brief list>."
)
```

Or for edits:

```
SendMessage(
  to="team-lead",
  summary="updated <name>",
  message="Updated <name>.ts in place — replaced body with new teaching; args: { <list> }; annotations woven in: <brief list>."
)
```

For splits, one message per snippet, in order.

Then idle. The next cap may arrive immediately, much later, or never (if the user wraps up). On shutdown_request, respond with shutdown_response.
