# /forge — clean reference

Loaded by `/forge`'s router for the **clean** route. The router has stripped the `clean` keyword from the args; the remaining text (possibly empty) is the optional scope: `snippets`, `hints`, or `both` (default).

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below — substitute the literal path captured in SKILL.md phase 1.0.

You are the **lead**. No agent team — the scan script does deterministic analysis; you apply judgement and surface findings via `AskUserQuestion`. The script never mutates the project.

## Phase 1 — Locate forge root and scan

### 1.1. Resolve forge root

```bash
node <PLUGIN_ROOT>/scripts/forge-find-root.mjs
```

Capture as `FORGE_ROOT`. If it fails (non-zero exit), relay verbatim and stop — the user needs `/forge init`.

### 1.2. Run the cleanup scan

```bash
node <PLUGIN_ROOT>/scripts/forge-cleanup-scan.mjs --forge-root <FORGE_ROOT> --scope <SCOPE>
```

Where `<SCOPE>` is `snippets`, `hints`, or `both`. The script:

- Regenerates `<FORGE_ROOT>/snippets/INDEX.md` first (snippet/both scopes only) so subsequent reads see fresh data.
- Walks `forge/snippets/*.ts` and `forge/hints/*.md` (excluding `README.md`), applying lint rules.
- Emits a single JSON document to stdout. Read it.

Read-only. Produces the raw candidate list; decisions are yours.

### 1.3. JSON shape (overview)

```jsonc
{
  "forgeRoot": "...",
  "scope": "both",
  "indexRefreshed": true,
  "snippets": {
    "files": [{ "file": "x.ts", "name": "x" }, ...],
    "flagged": [
      { "file": "...", "name": "...",
        "flags": [ { "kind": "low-value-tags" | "description-missing" | "meta-missing-or-broken" | "jira-key-named", "detail": "..." } ] }
    ],
    "overlapClusters": {
      "byFlowPhase":   [ { "flow": "...", "phase": "...", "snippets": ["a", "b"] } ],
      "byDescription": [ { "snippets": ["a", "b"], "similarity": 0.71 | "self-referenced-alternative", "descriptions": [...] } ],
      "byBody":        [ { "snippets": [...], "sharedLines": 4, "preview": "..." },
                         { "snippets": [...], "sharedSelectorFamily": "#firstName${i}", "evidence": "..." } ]
    }
  },
  "hints": {
    "files":    [ { "file": "...", "lineCount": ..., "bulletCount": ..., "mtime": "ISO" } ],
    "sections": [
      { "file": "...", "heading": "...", "startLine": ..., "quote": "<~160 chars>",
        "flags": [ { "kind": "fenced" | "indented" | "procedure-shaped" | "fixture-data" | "cross-file-dupe" | "orphan-reference" | "todo-masquerade", ... } ] }
    ]
  },
  "stalenessFile": { "path": "...", "exists": ..., "contents": ... }
}
```

## Phase 2 — Surface findings

Group candidates by category and surface via `AskUserQuestion` with `multiSelect: true`. Up to 4 options per question; multiple questions per call. Option-shape mirrors `proposals.md` §3.4.

Intro line:

> **Cleanup candidates.** Patterns the scan surfaced as worth tidying. Each is independent — accept what improves your library, reject the rest.

For each candidate option:

- **Label** — short, identifies the candidate (e.g., `"Merge submit-group-* snippets"`).
- **Description** — enough for a blind decision:
  - Filename(s) involved.
  - Lint classification or overlap evidence (quote relevant text, ~120 chars).
  - **Proposed action** as a concrete sentence. Examples below.

### Suggested groupings

Group the AskUserQuestion call by category so each question's options are comparable:

1. **Snippet merges / supersedes** (from `byFlowPhase`, `byDescription`, `byBody` with `sharedLines`). Propose: "Merge `A.ts` and `B.ts` — N shared body lines, descriptions overlap. Collapse to one with `<arg>?: <type>` to parameterise the difference."
2. **Snippet forks on selectors** (`byBody` with `sharedSelectorFamily`). Propose: "Reconcile `A.ts`, `B.ts`, `C.ts` — all target `#firstName<i>` family with different index bases. Decide which base is correct and supersede the others."
3. **Snippet rename / meta fix** (`flagged: jira-key-named`, `description-missing`, `meta-missing-or-broken`, `low-value-tags`). Propose: "Rename `proj-1785-checkout-flow.ts` → `<intent-named>.ts`" or "Add real `meta.tags` to `<file>` (currently just `['auto-authored']`)".
4. **Hint sections — code-shaped** (`fenced`, `indented`). Propose: "Move the fenced block in `<file>` § `<heading>` into snippet `<name>.ts` (or new snippet); replace the hint section with prose describing the intent."
5. **Hint sections — procedure** (`procedure-shaped`). Propose: "Extract the procedure in `<file>` § `<heading>` to `forge/hints/scripts/<name>.sh`; replace with prose pointer."
6. **Hint sections — fixture data** (`fixture-data`). Propose: "Lift the data block in `<file>` § `<heading>` into a fixture file (e.g. `forge/hints/scripts/<name>.fixture.json` or inline into the spec) — hints are for stable gotchas, not regression fixtures."
7. **Hint sections — duplicates** (`cross-file-dupe`). Propose: "`<file>` § `<heading>` duplicates prose from `<otherFile>`. Decide which file owns the gotcha; remove the other."
8. **Hint sections — TODO masquerade** (`todo-masquerade`). Propose: "`<file>` § `<heading>` reads as a TODO ('the snippet needs this fix applied'). Either apply the fix to the named snippet and delete the hint, or rewrite as a stable gotcha."
9. **Hint sections — orphan references** (`orphan-reference`). Propose: "`<file>` § `<heading>` references snippets that don't exist: `<list>`. Fix the names or remove the references."

When a candidate has multiple flags, surface it once with the strongest action and mention the secondary flag ("also duplicates prose in `spec.md`").

**Single-candidate case** — if only one candidate in the whole scan, use single-select (`multiSelect: false`) with Accept / Reject.

## Phase 3 — Apply accepted changes

For each accepted candidate, do the work directly. Most cleanups are simple edits:

- **Rename a snippet.** `mv` the file, then update any spec/snippet that imports its name. Glob/Grep first.
- **Fix `meta` fields.** Edit the `meta` block to add `description`, replace low-value `tags`, or fix the schema.
- **Delete a hint section.** Remove the block (heading + body up to the next heading/bullet at the same level).
- **Move a hint section.** Read the destination, append/insert in a sensible place, remove from original. Preserve prose verbatim unless the move requires reframing.

For changes needing real code work — merging two snippet bodies with a parameterised arg, extracting a fenced block into a new snippet, building a hint-script — judge complexity:

- **Light** (collapse two near-identical bodies, add a sentinel arg): do it with Edit/Write.
- **Heavy** (extract a non-trivial new snippet, write a procedure script): write the file, sanity check (`node -c <file>` for JS/TS, `bash -n <file>` for shell), confirm it worked. If runtime semantics need validation you can't do without driving, surface that in the final report — the user may want a follow-up `/forge spec`.

After each merge/supersede, regenerate the snippet INDEX:

```bash
node <PLUGIN_ROOT>/scripts/forge-snippet-index.mjs <FORGE_ROOT>
```

## Phase 4 — Update the staleness file

Write `<FORGE_ROOT>/.last-cleanup` as JSON. Preserve any existing keys you didn't touch:

```json
{ "hints": "2026-06-20T12:34:56Z", "snippets": "2026-06-20T12:34:56Z" }
```

Update only the keys matching the scope cleaned this run. For `--scope both`, write both.

The file is gitignored in the standard `/forge init` scaffold. If it isn't, mention it in the final report — the user should add it before committing.

## Phase 5 — Report to the user

Compose a tight summary. Drop sections that don't apply:

> **Cleanup complete — scope: <scope>.**
>
> Snippets:
>   - Merged: `<A>`, `<B>` → `<merged>` (parameterised on `<arg>`)
>   - Renamed: `proj-1785-checkout-flow.ts` → `<new>.ts`
>   - Updated meta on N snippets
>   - INDEX.md regenerated
>
> Hints:
>   - Deleted N section(s): `<file>` § `<heading>` ...
>   - Moved 1 section: `<file>` § `<heading>` → `<otherFile>`
>   - Extracted 1 procedure to `forge/hints/scripts/<name>.sh`
>
> Staleness file updated: `<FORGE_ROOT>/.last-cleanup`.
>
> (Optionally: "Note — `.last-cleanup` isn't in `<FORGE_ROOT>/.gitignore`; add it before committing.")

Omit rejected candidates — the user already saw them. If nothing was accepted, the report is just "Scan completed. No changes applied."

## Hard rules

- **Apply changes only after user accepts via AskUserQuestion.** The scan is read-only; the lead never edits silently.
- **Never delete a snippet without checking for callers.** Glob/Grep specs and other snippets for the name first; if anything imports it, raise the conflict in the final report rather than orphan callers.
- **Preserve hint prose verbatim when moving between files.** Reframing belongs in a follow-up — this route is cleanup, not rewriting.
- **Regenerate INDEX.md after snippet renames/merges.** Specs reference snippets by name; the INDEX is the lookup table.
- **Single team-aware tool: AskUserQuestion.** No agent spawns — clean is a solo lead workflow.
