# /forge — export reference

Loaded by `/forge`'s router for the **export** route. The router stripped the `export` keyword; the remaining text is the spec name (possibly empty, possibly with `--output <path>`).

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below — substitute the literal path captured in SKILL.md phase 1.0. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in this bash context.

## What this route does

Exports a composed forge spec (working artifact, imports from `forge/snippets/`) into its inlined form (self-contained; ships anywhere `@playwright/test` is installed).

1. Walks up from CWD to find `forge/`.
2. Lists specs in `<forge>/specs/`. If no spec name was provided, surfaces the list via AskUserQuestion.
3. Resolves the spec path: `<forge>/specs/<name>.spec.ts`.
4. Default output: `<project-root>/forge-exports/<name>.spec.ts` — **outside** the gitignored `forge/`, so the exported spec follows the project's main `.gitignore` policy. Override with `--output <path>` to drop the spec into the main test suite (e.g. `e2e-tests/cart.spec.ts`).
5. Creates the output's parent directory if needed.
6. Invokes `forge-export-spec.mjs --spec <input> --output <output> --force`.
7. Reports the outcome.

The exported spec lives outside `forge/` deliberately — composed form (evolves with library) stays in gitignored `forge/specs/`; exported form (shipping snapshot) lives where the project's normal source-control policy applies.

## Phase 1 — Discovery

### 1.1. Find the project's forge root

```bash
node <PLUGIN_ROOT>/scripts/forge-cli.mjs find-root
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge init` first.

Capture as `FORGE_ROOT`.

### 1.2. List available specs

```bash
ls <FORGE_ROOT>/specs/*.spec.ts 2>/dev/null
```

If no specs exist, surface: *"No specs found in `<FORGE_ROOT>/specs/`. Run `/forge spec <task>` to produce one first."* and stop.

## Phase 2 — Resolve the target spec

### 2.1. Argument handling

`<spec-name>` can be:
- Basename without extension: `add-backpack-to-cart-standard`
- Full filename: `add-backpack-to-cart-standard.spec.ts`
- Absolute path: `/path/to/.../forge/specs/<name>.spec.ts`

Normalize to an absolute path. If the file doesn't exist under `<FORGE_ROOT>/specs/`, surface a clear error.

### 2.2. No spec name? Ask.

If `$ARGUMENTS` (after route stripping) is empty/whitespace, use AskUserQuestion (up to 4 options):

```
AskUserQuestion(
  questions: [{
    question: "Which spec would you like to export?",
    header: "Spec to export",
    options: [
      { label: "<spec1-basename>", description: "<first line of test('...') name if discoverable, else 'unknown'" },
      { label: "<spec2-basename>", description: "..." },
      ...
    ],
    multiSelect: false,
  }]
)
```

For more than 4, mention this in the question text and show the first 3 plus "Other (specify by name)".

## Phase 3 — Export

Compute paths:
- `PROJECT_ROOT` = `dirname(FORGE_ROOT)`
- `OUTPUT_PATH` = `<PROJECT_ROOT>/forge-exports/<name>.spec.ts` (default), or `--output` if passed

Ensure the output's parent directory exists:

```bash
mkdir -p "$(dirname OUTPUT_PATH)"
```

Then export:

```bash
node <PLUGIN_ROOT>/scripts/forge-cli.mjs export-spec \
  --spec <FORGE_ROOT>/specs/<name>.spec.ts \
  --output <OUTPUT_PATH> \
  --force
```

`--force` is safe because the exported spec is a derived artifact — re-exporting overwrites the previous snapshot intentionally.

## Phase 4 — Report

> Exported `<name>.spec.ts` → `<output-relative-to-project-root>`.
>
> Inlined N snippets: <list>.
>
> The exported spec lives outside `forge/` so it's trackable by your project's normal git policy. It only needs `@playwright/test` to run — no forge dependency, no snippets directory. To ship into your main test suite, either commit `forge-exports/` or re-run `/forge export` with `--output <path>` to write directly where your tests live.

If forge-export-spec.mjs returned a non-zero exit code, surface its error verbatim and don't claim success.

## Hard rules

- **You are a thin wrapper.** Transformation logic lives in `forge-export-spec.mjs`. This route exists for UX — path defaulting, spec listing, friendly error surfaces.
- **Default output location is canonical.** `<PROJECT_ROOT>/forge-exports/<name>.spec.ts`. Only deviate with explicit `--output`.
- **Invoke the script for file writing.** The script writes; you `mkdir -p` the parent directory beforehand — the script doesn't create directories.
- **Surface script errors verbatim.** If `forge-export-spec.mjs` fails, the user needs the exact reason (missing spec, no snippet imports, etc.).

## Failure modes

- **Spec doesn't exist under `forge/specs/`** — surface "spec not found" with available specs.
- **No `forge/` directory** — surface forge-find-root.mjs's error and instruct `/forge init`.
- **`forge-export-spec.mjs` reports no snippet imports** — surface its message; spec is already inlined (or wasn't composed).
