# /forge — proposal-review reference

Loaded on-demand by the lead (from `team-task.md`, including teach-route runs) **only when at least one teammate reported proposals to review**. Skip entirely when all teammates report `proposals: 0`.

The caller has already:

- Confirmed at least one teammate reported `proposals: N > 0`.
- Received `PROPOSALS` SendMessages from those teammates.
- Captured `PLUGIN_ROOT` and `FORGE_ROOT`.

You handle aggregation, user review, and application.

## 1. Aggregate proposals

Each `PROPOSALS` SendMessage body has this format:

```
PROPOSALS
count: <N>

---
ID: 1
CATEGORY: <hint file name, e.g. driver.md>
ACTION: ADD | AMEND | REMOVE
TARGET: <section heading, quoted prose, or empty for ADD-new>
OBSERVATION: <one-line>
EVIDENCE: <concrete>
SUGGESTED_EDIT: |
  <markdown prose, or empty for REMOVE>

(optional)
ALTERNATIVES:
- A: <option>
- B: <option>
LEAN: A | B | none

(optional)
RATIONALE: <one-line>

---
ID: 2
...
```

Parse each. Collect across all teammates into a single list.

**Dedupe.** If two proposals (from different teammates) have substantially similar `OBSERVATION` AND target the same `CATEGORY`, merge: keep the one with more specific `EVIDENCE`; mention both proposing teammates in the displayed evidence.

## 2. Read current hint content for AMEND/REMOVE proposals

For each `AMEND`/`REMOVE` proposal, read `<FORGE_ROOT>/hints/<CATEGORY>` and locate the `TARGET` text. Needed for the diff preview (step 3) and application (step 4).

If `TARGET` isn't found, mark **stale** — file has changed since the agent observed. Quietly drop and continue.

## 2.5. Lint proposals

Walk each surviving proposal through two checks. Checks don't drop proposals — they tag them so step 3 can offer an extra reject option naming the real problem.

### 2.5a. Code-shaped content

Inspect the content the proposal would introduce — `SUGGESTED_EDIT` for `ADD`, replacement text for `AMEND`. Flag as `code-shaped` if either holds:

- A fenced code block whose body exceeds 3 lines.
- More than ~80 characters of indented monospace (4-space or tab-indented) code outside a fence.

Code-shaped content belongs in a snippet, not a hint. Hints carry intent and gotchas in prose; snippets carry executable shape. Don't drop — step 3 surfaces an extra option to reject on the grounds that the fix belongs in a snippet.

### 2.5b. Cross-file duplication

For each `ADD` proposal, scan the *other* hint files (every `<FORGE_ROOT>/hints/*.md` except the proposal's `CATEGORY`). Look for substantially similar text: a selector, a named gotcha, a distinctive phrase from `OBSERVATION` or `SUGGESTED_EDIT` that already appears elsewhere.

If a near-match exists, flag as `duplicates-elsewhere` and capture the matching file path + a short verbatim quote (~120 chars). Step 3 surfaces an extra option: "the text exists in the other file; move it instead." Don't perform the move — flagging is enough; the user decides.

A proposal can carry both flags. Both surface independently in step 3.

## 3. Surface to the user

Begin with this intro line (every time, even on repeated runs):

> **Hint proposals.** Patterns the team observed during this session that might be worth lifting into your project's hint files. Each is independent — accept what improves your hints, reject the rest.

Surface proposals via `AskUserQuestion` with `multiSelect: true`. One option per proposal. Up to 4 proposals per question; for more, use multiple questions in the same call (up to 4 × 4 = 16 per call; make a second call beyond that).

**Single-proposal case**: exactly one proposal → single-select (`multiSelect: false`) with Accept / Reject.

**Option label**: short (e.g., `"FORGE_BASE_URL env contract"`).

**Option description**:

- `[<ACTION> <CATEGORY>]` prefix
- `OBSERVATION`
- `EVIDENCE` (one-line)
- For `ADD`: `SUGGESTED_EDIT` prose (first ~200 chars)
- For `AMEND`: inline diff showing existing `TARGET` → `SUGGESTED_EDIT` (use `→` or `replaces`)
- For `REMOVE`: `removes: <TARGET first ~100 chars>`
- If `ALTERNATIVES` present, list as sub-bullets

For `AMEND`/`REMOVE`, **always show existing prose alongside the proposed change** — the user accepts blind otherwise.

**Lint-flagged proposals get extra options.** A flagged proposal keeps its normal Accept (multi-select treats unchecked as reject). Add one extra option *per flag*:

- `code-shaped`: sibling option **"Reject — should be a snippet fix"** with description: *"This proposal carries >3 lines of fenced code (or substantial indented code). Hints carry prose intent; executable shape belongs in a snippet. Selecting this rejects the proposal and signals the fix should land in a snippet instead."*
- `duplicates-elsewhere`: sibling option **"Move existing text instead"** quoting the matching text and naming the file: *"`<other-file>` already contains: \"<verbatim quote ~120 chars>\". Selecting this rejects the proposal as-is and signals the existing text should be moved to `<CATEGORY>` rather than duplicated."* The lead does not perform the move — surfacing the conflict is the contract.

Single-proposal mode with flags: single-select with Accept + Reject + each applicable lint-flag option (up to 4 options for a doubly-flagged proposal). In multi-select mode, lint-flag options are conceptually mutually exclusive with Accept for the same proposal but technically independent checkboxes — if the user ticks both, prefer the lint-flag option and note the conflict in the application summary.

## 4. Apply accepted proposals

For each accepted proposal:

1. Re-read the target hint file (line numbers may have shifted from prior accepts).
2. Apply:
   - **`ADD`**: locate the matching heading and append `SUGGESTED_EDIT` under it. No matching section → new section at end of file. File doesn't exist → create it.
   - **`AMEND`**: find the exact `TARGET` text and replace with `SUGGESTED_EDIT`.
   - **`REMOVE`**: find the exact `TARGET` text and remove it.
3. If `TARGET` can't be found at application time, warn the user and skip: *"Proposal '<label>' target text not found in <file>; skipping."*

Apply in order; re-read between each to handle shifting offsets.

## 5. Hand back to the caller

Build a one-line-per-file summary:

```
forge/hints/driver.md       (+2 sections: <names>)
forge/hints/snippet-author.md (+1 amendment, +1 new section)
```

Return to the caller (`team-task.md` Phase 5) for the "Hint files updated" line in the final report. Omit the line if nothing was accepted.

## Hard rules

- **Apply changes only after user accepts via AskUserQuestion.** Never apply silently.
- **Don't modify any file outside `<FORGE_ROOT>/hints/<X>.md`.** Snippets, specs, plugin files are out of scope.
- **Don't propose or apply hints about forge's own behavior** — only the project's app/conventions. (Defense-in-depth; the proposing agent should already have filtered.)
- **Empty proposals don't reach you** — the caller filtered the all-zero case. If you arrive with zero proposals after parsing, exit quietly.
