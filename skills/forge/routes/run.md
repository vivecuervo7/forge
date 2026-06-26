# /forge — run reference

Loaded by `/forge`'s router for the **run** route. The router stripped the `run` keyword and captured `RECORD_AS` (label or `none`). What remains is the spec reference — explicit name, `last` / `latest`, or empty (ask the user).

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below — substitute the literal path captured in SKILL.md phase 1.0. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in this bash context.

## What this route does

Re-runs an existing verified spec via `forge-run-spec.mjs`. No team is spawned — just the spec runner against an existing artifact.

Optionally records a video (when `RECORD_AS` is set) at `forge/videos/<spec-basename>-<RECORD_AS>.webm`. The recording is evidence — typically a before/after workflow where the same spec runs twice against different code states.

The script uses Playwright's ephemeral browser context. Env values come from `process.env` at invocation time — user's shell env (direnv, manual exports) plus anything the project's `forge/playwright.config.ts` loads. To use a different test account, override via shell env: `SAUCE_USERNAME=problem_user /forge run last spec, record as problem-flow`.

## Phase 1 — Discovery

### 1.1. Find the project's forge root

```bash
node <PLUGIN_ROOT>/scripts/forge-find-root.mjs
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge init` first.

Capture as `FORGE_ROOT`.

### 1.2. List available specs

```bash
ls -t <FORGE_ROOT>/specs/*.spec.ts 2>/dev/null
```

The `-t` flag sorts by modification time, most recent first — useful for `last` / `latest`.

If no specs exist, surface: *"No specs found in `<FORGE_ROOT>/specs/`. Run `/forge spec <task>` to produce one first."* and stop.

## Phase 2 — Resolve the target spec

Three input shapes:

### 2.1. Explicit spec name

Examples: `add-backpack-to-cart-standard`, `add-backpack-to-cart-standard.spec.ts`, `/absolute/path/.../specs/<name>.spec.ts`.

Normalize to an absolute path under `<FORGE_ROOT>/specs/`. If the file doesn't exist, surface "spec not found" with the available list.

### 2.2. `last` / `latest`

Most recently modified spec from `ls -t` above. Tell the user which one so they can correct you:

> Resolved `last` → `add-backpack-to-cart-standard.spec.ts` (modified <when>).

### 2.3. No spec reference (empty args after RECORD_AS extraction)

Use `AskUserQuestion` to let the user pick (up to 4 options):

```
AskUserQuestion(
  questions: [{
    question: "Which spec would you like to run?",
    header: "Spec to run",
    options: [
      { label: "<spec1-basename>", description: "modified <YYYY-MM-DD HH:MM>" },
      { label: "<spec2-basename>", description: "..." },
      ...
    ],
    multiSelect: false,
  }]
)
```

For more than 4, include the most-recent 3 plus "Other (specify by name)". Normalize to an absolute path and proceed.

## Phase 3 — Run

Compose the invocation. Add `--record-as <RECORD_AS>` only when `RECORD_AS != none`:

```bash
node <PLUGIN_ROOT>/scripts/forge-run-spec.mjs \
  --spec <FORGE_ROOT>/specs/<resolved-name>.spec.ts
# If RECORD_AS is set, append: --record-as <RECORD_AS>
```

The script handles project-runner detection vs plugin-fallback (lazy-installs on first use). With `--record-as`, it persists `video.webm` to `<FORGE_ROOT>/videos/<spec-basename>-<RECORD_AS>.webm`.

Capture exit code and stderr. Exit 0 = all assertions passed (green); non-zero = some failed.

**Mind the spec's intent.** A green/red exit is only "good/bad" for a regression spec. A **repro** spec (one with `expect.soft` bug claims asserting correct behavior) is *expected* to be red while the bug is open — running it red confirms the bug still reproduces; running it **green means the bug is now fixed** (the red→green moment). `/forge run` is the natural way to re-check a repro after a fix, often paired with `record as before` (buggy, red) and `record as after` (fixed, green) for evidence. Report the result in those terms rather than a blanket "pass/fail" when the spec is a repro.

## Phase 4 — Report

**On pass without recording:**

> Ran `<spec-name>.spec.ts` — **passed** in <duration>.

**On pass with recording:**

> Ran `<spec-name>.spec.ts` — **passed** in <duration>. Video: `<FORGE_ROOT>/videos/<spec-basename>-<RECORD_AS>.webm`.
>
> The wrapper's stderr line `forge-run-spec: persisted recording → <path>` confirms the persisted location.

**On fail:**

> Ran `<spec-name>.spec.ts` — **FAILED** after <duration>. <script-error-summary>.
>
> The spec needs investigation. Suggest `/forge spec <original-task>` to re-author, or open the spec and inspect the failure.

Surface the script's error output verbatim — the user needs to see exactly what Playwright reported.

## Hard rules

- **No team involved.** Thin script invocation. Don't spawn driver, snippet-author, spec-writer, or spec-verifier. Re-authoring is `/forge spec`'s job.
- **Thin script invocation.** Playwright launches its own browser; env comes from `process.env` (user's shell + `forge/playwright.config.ts`). The spec runs as a standalone Playwright test.
- **Default to verification-only.** When `RECORD_AS = none`, do NOT pass `--record`. Recordings are explicit; silent recording bloats `forge/videos/`.
- **Surface script errors verbatim.** Playwright's report (which selector failed, which assertion mismatched) — don't paraphrase.

## Failure modes

- **Spec doesn't exist under `forge/specs/`** — surface "spec not found" with available specs.
- **No `forge/` directory** — surface forge-find-root.mjs's error and instruct `/forge init`.
- **Plugin runner missing** — lazy-installs on first use; if install fails, surface the npm error.
- **Ambiguous "last"** — if intent isn't clear, prefer the most-recent and tell the user which.

## Why recording is here, not in spec mode

Recording is **evidence** — typically before/after videos around the same spec to document a bug fix. If recording lived in spec mode, you'd re-author each time you wanted fresh evidence, conflating two distinct intents:

- **Spec mode**: "Capture this behavior as a runnable test." (One-time author + verify.)
- **Run mode**: "Re-run this test, optionally with a label for evidence." (Repeatable.)

The workflow this enables:

```
/forge spec add backpack to cart
  ↓ authors + verifies the spec
/forge run last spec, record as before
  ↓ runs against current (buggy) code, records evidence
<fix the bug>
/forge run last spec, record as after
  ↓ runs against fixed code, records evidence
<raise PR with paired before/after videos>
```
