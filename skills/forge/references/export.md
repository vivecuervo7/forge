# /forge — export reference

This reference is loaded by `/forge`'s router for the **export** route. The router has stripped the `export` keyword from the args; the remaining text is the spec name (possibly empty, possibly with a `--output <path>` flag).

## What this route does

Exports a composed forge spec (the working artifact that imports from `forge/snippets/`) into its inlined form (self-contained, ships anywhere `@playwright/test` is installed).

1. Walks up from CWD to find the project's `forge/` directory.
2. Lists specs in `<forge>/specs/`. If no spec name was provided, surfaces the list via AskUserQuestion so the user can pick.
3. Resolves the spec path: `<forge>/specs/<name>.spec.ts`.
4. Computes the default output path: `<project-root>/forge-exports/<name>.spec.ts` — **outside** the gitignored `forge/` directory, so the exported spec is naturally trackable by the project's main `.gitignore` policy (the user decides whether to commit). The user can override with `--output <path>` to drop the spec directly into their project's main test suite (e.g. `e2e-tests/cart.spec.ts`).
5. Creates the output's parent directory if it doesn't exist.
6. Invokes `forge-export-spec.mjs --spec <input> --output <output> --force`.
7. Reports the outcome.

The exported spec lives outside `forge/` deliberately — the composed form (working artifact, evolves with library) stays in the gitignored `forge/specs/`; the exported form (shipping artifact, frozen snapshot) lives where your project's normal source-control policy applies.

## Phase 1 — Discovery

### 1.1. Find the project's forge root

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-find-root.sh
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

The user invokes the route as `/forge export <spec-name>`. The `<spec-name>` can be:
- The basename without extension: `add-backpack-to-cart-standard`
- The full filename: `add-backpack-to-cart-standard.spec.ts`
- An absolute path: `/path/to/.../forge/specs/<name>.spec.ts`

Normalize to an absolute path. If the file doesn't exist under `<FORGE_ROOT>/specs/`, surface a clear error.

### 2.2. No spec name? Ask.

If `$ARGUMENTS` (after route stripping) is empty or whitespace, use AskUserQuestion to let the user pick. Build a question with the available specs as options (up to 4):

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

If there are more than 4, mention this in the question text and show the first 3 specs plus "Other (specify by name)". Take the user's pick, then proceed.

## Phase 3 — Export

Compute paths:
- `PROJECT_ROOT` = `dirname(FORGE_ROOT)` (the directory containing `forge/`)
- `OUTPUT_PATH` = `<PROJECT_ROOT>/forge-exports/<name>.spec.ts` (default), OR the `--output` value if the user passed one

Ensure the output's parent directory exists:

```bash
mkdir -p "$(dirname OUTPUT_PATH)"
```

Then export:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-export-spec.mjs \
  --spec <FORGE_ROOT>/specs/<name>.spec.ts \
  --output <OUTPUT_PATH> \
  --force
```

`--force` is safe because the convention is that the exported spec is a derived artifact — re-exporting overwrites the previous snapshot intentionally.

## Phase 4 — Report

Surface a tight summary:

> Exported `<name>.spec.ts` → `<output-relative-to-project-root>`.
>
> Inlined N snippets: <list>.
>
> The exported spec lives outside `forge/` so it's trackable by your project's normal git policy. It only needs `@playwright/test` to run — no forge dependency, no snippets directory. To ship into your project's main test suite, either commit `forge-exports/` to your repo, or re-run /forge export with `--output <your-test-suite-path>` to drop the spec directly where your tests live.

If forge-export-spec.mjs returned a non-zero exit code, surface its error message verbatim and don't claim success.

## Hard rules

- **You are a thin wrapper.** All the transformation logic lives in `forge-export-spec.mjs`. This route exists for UX — path defaulting, spec listing, friendly error surfaces. Don't try to inline logic the script already handles.
- **Default output location is canonical.** `<PROJECT_ROOT>/forge-exports/<name>.spec.ts`. Only deviate if the user passed an explicit `--output` override.
- **Invoke the script for file writing.** The script writes the output. You just invoke it and report. You DO `mkdir -p` the output's parent directory if needed — the script doesn't create directories.
- **Surface script errors verbatim.** If `forge-export-spec.mjs` fails, the user needs to see the exact reason (missing spec, no snippet imports, etc.).

## Failure modes

- **Spec doesn't exist under `forge/specs/`** — surface "spec not found" with the list of available specs.
- **No `forge/` directory** — surface forge-find-root.sh's error and instruct user to run `/forge init`.
- **`forge-export-spec.mjs` reports no snippet imports** — surface its message; the spec is already inlined (or wasn't composed in the first place).
