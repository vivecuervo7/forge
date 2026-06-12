---
name: forge-export
description: "Export a composed forge spec to a self-contained inlined form, suitable for shipping into another project's test suite. Wraps forge-export-spec.mjs with sensible defaults (output lands beside the composed spec as `<name>.exported.spec.ts`). Triggers on `/forge-export <spec-name>` slash invocation."
model: haiku
effort: low
argument-hint: "<spec-name>"
allowed-tools: Read, Glob, Bash(node **/forge/*/scripts/*), Bash(bash **/forge/*/scripts/*), Bash(ls:*), Bash(cat:*), AskUserQuestion
---

# /forge-export

Export a composed forge spec (the working artifact that imports from `forge/snippets/`) into its inlined form (self-contained, ships anywhere `@playwright/test` is installed).

## What this skill does

1. Walks up from CWD to find the project's `forge/` directory.
2. Lists specs in `<forge>/specs/`. If no spec name was provided as an argument, surfaces the list via AskUserQuestion so the user can pick.
3. Resolves the spec path: `<forge>/specs/<name>.spec.ts`.
4. Computes the default output path: `<forge>/specs/<name>.exported.spec.ts` (sibling to the original, with `.exported` infix).
5. Invokes `forge-export-spec.mjs --spec <input> --output <output> --force`.
6. Reports the outcome.

The exported file is gitignored along with everything else in `forge/`. To ship the spec into your project's main test suite, copy it from `forge/specs/<name>.exported.spec.ts` to wherever your test runner looks.

The scaffolded `forge/playwright.config.ts` has `testIgnore: '**/*.exported.spec.ts'`, so the forge runner only runs the composed versions — the exported ones sit beside their originals for easy inspection without doubling up the test run.

## Phase 1 — Discovery

### 1.1. Find the project's forge root

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-find-root.sh
```

If it fails (exit non-zero), relay verbatim and stop. The user needs `/forge-init` first.

Capture as `FORGE_ROOT`.

### 1.2. List available specs

```bash
ls <FORGE_ROOT>/specs/*.spec.ts 2>/dev/null
```

Filter out anything ending in `.exported.spec.ts` (those are already exported).

If no composed specs exist, surface: *"No specs found in `<FORGE_ROOT>/specs/`. Run `/forge-team <task>` to produce one first."* and stop.

## Phase 2 — Resolve the target spec

### 2.1. Argument handling

The user invokes the skill as `/forge-export <spec-name>`. The `<spec-name>` can be:
- The basename without extension: `add-backpack-to-cart-standard`
- The full filename: `add-backpack-to-cart-standard.spec.ts`
- An absolute path: `/path/to/.../forge/specs/<name>.spec.ts`

Normalize to an absolute path. If the file doesn't exist under `<FORGE_ROOT>/specs/`, surface a clear error.

### 2.2. No argument? Ask.

If `$ARGUMENTS` is empty or whitespace, use AskUserQuestion to let the user pick. Build a question with the available specs as options (up to 4):

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

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/forge-export-spec.mjs \
  --spec <FORGE_ROOT>/specs/<name>.spec.ts \
  --output <FORGE_ROOT>/specs/<name>.exported.spec.ts \
  --force
```

`--force` is safe because the convention is that the exported spec is a derived artifact — re-exporting overwrites the previous snapshot intentionally.

## Phase 4 — Report

Surface a tight summary:

> Exported `<name>.spec.ts` → `<name>.exported.spec.ts` (sibling, in `forge/specs/`).
>
> Inlined N snippets: <list>.
>
> Both files are gitignored. To ship into your project's main test suite, copy the `.exported.spec.ts` to wherever your project keeps its E2E tests. It only needs `@playwright/test` to run — no forge dependency, no snippets directory.

If forge-export-spec.mjs returned a non-zero exit code, surface its error message verbatim and don't claim success.

## Hard rules

- **You are a thin wrapper.** All the transformation logic lives in `forge-export-spec.mjs`. This skill exists for UX — path defaulting, spec listing, friendly error surfaces. Don't try to inline logic the script already handles.
- **Default output location is canonical.** `<FORGE_ROOT>/specs/<name>.exported.spec.ts`. Only deviate if the user passed an explicit `--output` override (not supported in v1; could be added later).
- **Don't write files yourself.** The script writes the output. You just invoke it and report.
- **Surface script errors verbatim.** If `forge-export-spec.mjs` fails, the user needs to see the exact reason (missing spec, no snippet imports, etc.).

## Failure modes

- **Spec doesn't exist under `forge/specs/`** — surface "spec not found" with the list of available specs.
- **Spec is already an exported one** (ends in `.exported.spec.ts`) — surface "that's an exported spec; you probably meant `<name without .exported>`".
- **No `forge/` directory** — surface forge-find-root.sh's error and instruct user to run `/forge-init`.
- **`forge-export-spec.mjs` reports no snippet imports** — surface its message; the spec is already inlined (or wasn't composed in the first place).
