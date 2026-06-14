# /forge — run reference

This reference is loaded by `/forge`'s router for the **run** route. The router has stripped the `run` keyword from the args and captured `RECORD_AS` (label or `none`). What remains is the spec reference — explicit name, `last` / `latest`, or empty (in which case you'll ask the user).

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below is a placeholder — substitute the literal path the router captured in SKILL.md phase 1.0. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in the bash context that runs from this reference.

## What this route does

Re-runs an existing verified spec via `forge-pool-run-spec.mjs`. No team is spawned — no driver, no snippet-author, no spec-writer, no spec-verifier. Just the spec runner against an existing artifact.

Optionally records a video (when `RECORD_AS` is set) at `forge/videos/<spec-basename>-<RECORD_AS>.webm`. The recording is evidence — typically used in a before/after workflow where the same spec is run twice against different code states.

No pool slot is claimed. The script uses Playwright's ephemeral browser context; credentials come from the project's `forge/.env` (loaded by `forge/playwright.config.ts`). To use a different persona, the user overrides via shell env before invoking, e.g. `SAUCE_USERNAME=problem_user /forge run last spec, record as problem-flow`.

## Phase 1 — Discovery

### 1.1. Find the project's forge root

```bash
bash <PLUGIN_ROOT>/scripts/forge-find-root.sh
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge init` first.

Capture as `FORGE_ROOT`.

### 1.2. List available specs

```bash
ls -t <FORGE_ROOT>/specs/*.spec.ts 2>/dev/null
```

The `-t` flag sorts by modification time, most recent first — useful for resolving `last` / `latest`.

If no specs exist, surface: *"No specs found in `<FORGE_ROOT>/specs/`. Run `/forge spec <task>` to produce one first."* and stop.

## Phase 2 — Resolve the target spec

Three input shapes the user might give you:

### 2.1. Explicit spec name

Examples: `add-backpack-to-cart-standard`, `add-backpack-to-cart-standard.spec.ts`, `/absolute/path/.../specs/<name>.spec.ts`.

Normalize to an absolute path under `<FORGE_ROOT>/specs/`. If the file doesn't exist, surface "spec not found" with the list of available specs.

### 2.2. `last` / `latest`

Resolve to the most recently modified spec from the `ls -t` output above. Take the first line. Tell the user which spec you picked so they can correct you if it's not what they meant:

> Resolved `last` → `add-backpack-to-cart-standard.spec.ts` (modified <when>).

### 2.3. No spec reference (empty args after route + RECORD_AS extraction)

Use `AskUserQuestion` to let the user pick from the available specs. Build a question with the available specs as options (up to 4):

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

If there are more than 4, include the most-recently-modified 3 plus "Other (specify by name)". Take the user's pick, normalize to an absolute path, then proceed.

## Phase 3 — Run

Compose the invocation. Add `--record-as <RECORD_AS>` only when `RECORD_AS != none`:

```bash
node <PLUGIN_ROOT>/scripts/forge-pool-run-spec.mjs \
  --spec <FORGE_ROOT>/specs/<resolved-name>.spec.ts
# If RECORD_AS is set, append: --record-as <RECORD_AS>
```

The script handles project-runner detection vs plugin-fallback (lazy-installs the plugin runner on first use). When `--record-as` is passed, it persists the resulting `video.webm` to `<FORGE_ROOT>/videos/<spec-basename>-<RECORD_AS>.webm`.

Capture the exit code and stderr output. Exit 0 = pass. Anything else = fail.

## Phase 4 — Report

**On pass without recording:**

> Ran `<spec-name>.spec.ts` — **passed** in <duration>.

**On pass with recording:**

> Ran `<spec-name>.spec.ts` — **passed** in <duration>. Video: `<FORGE_ROOT>/videos/<spec-basename>-<RECORD_AS>.webm`.
>
> The wrapper's stderr line `forge-pool-run-spec: persisted recording → <path>` confirms the persisted location.

**On fail:**

> Ran `<spec-name>.spec.ts` — **FAILED** after <duration>. <script-error-summary>.
>
> The spec needs investigation. Suggest `/forge spec <original-task>` to re-author from scratch, or open the spec and inspect the failure.

Surface the script's actual error output verbatim — the user needs to see exactly what Playwright reported.

## Hard rules

- **No team involved.** This route is a thin script invocation. Don't spawn driver, snippet-author, spec-writer, or spec-verifier. If the spec's authoring needs re-doing, that's `/forge spec`'s job.
- **No slot claim.** The script doesn't need pool semantics — Playwright launches its own browser, credentials come from `forge/.env`.
- **Default to verification-only.** When `RECORD_AS = none`, do NOT pass `--record` to the script. Recordings are an explicit user request; silent recording bloats `forge/videos/` and wastes time.
- **Surface script errors verbatim.** If `forge-pool-run-spec.mjs` fails, the user needs to see Playwright's actual report (which selector failed, which assertion mismatched, etc.) — don't paraphrase.

## Failure modes

- **Spec doesn't exist under `forge/specs/`** — surface "spec not found" with the list of available specs.
- **No `forge/` directory** — surface forge-find-root.sh's error and instruct user to run `/forge init`.
- **Plugin runner missing** — the script lazy-installs on first use, but if installation fails, surface the npm error.
- **Ambiguous "last"** — if `ls -t` returns multiple specs and the user's intent isn't clear from context, prefer the most-recent and tell them which one you picked.

## Why recording is here, not in spec mode

Recording is **evidence** — typically used to document a bug fix by capturing before/after videos around the same spec. If recording lived in spec mode, you'd have to re-author the spec each time you wanted fresh evidence, which is wasteful and conflates two distinct user intents:

- **Spec mode**: "I want to capture this behavior as a runnable test." (One-time author + verify.)
- **Run mode**: "I want to re-run this test, optionally with a label for evidence." (Repeatable.)

The dream-state workflow this enables:

```
/forge spec AE-1775 add backpack to cart
  ↓ authors + verifies the spec
/forge run last spec, record as before
  ↓ runs against current (buggy) code, records evidence
<fix the bug>
/forge run last spec, record as after
  ↓ runs against fixed code, records evidence
<raise PR with paired before/after videos>
```
