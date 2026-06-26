# Proposals — the hint-proposal protocol

During a run, forge's agents notice patterns worth lifting into the project's hint files, and surface them at wrap-up for the user to accept or reject. This file is the one place that protocol lives: the **producers** (`driver-worker`, `snippet-curator`) emit per §1–§2; the **lead** reviews and applies per §3. One format, one set of rules, no drift.

Loaded on-demand: a producer `cat`s §1–§2 when it actually has something to surface (clean runs have nothing, so usually never); the lead `cat`s §3 only when a teammate reported `proposals: N > 0`.

## 1. The contract (the PROPOSALS message)

A producer with nothing to propose appends `proposals: 0` to its completion summary and sends no PROPOSALS message. A producer with ≥1 sends `summary="proposals: <N>"` plus a `message` body in **exactly** this shape — the lead parses it verbatim, so match it:

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

## 2. Producer side — when and what to propose

Be **conservative** — a clean run produces none. Proposals carry genuine, reusable project knowledge the run surfaced, not run commentary.

**Discipline (both producers):**

- Content over ~3 lines of code belongs *inside a snippet*, not a hint — the driver flags such a thing to the curator instead of proposing it.
- `REMOVE` needs the prose to have *actively caused a failure* this run.
- Re-read the target hint first to confirm it isn't already covered.
- Propose only about the *project's* app/conventions — never about forge's own behavior.

**Targets — propose against the hint files about your own work:**

*Driver-worker:*

- `forge.md` — SUT facts useful to everyone: a framework quirk + workaround, a selector mismatch, a route, an env-key gap, a cold-start timing pattern, a single-session-collision warning.
- `driver.md` — project-specific driving discipline.
- `spec-writer.md` — spec-composition shapes and data-passing idioms.
- `spec-verifier.md` — verification-level patterns: cold-start timing, env setup, test-isolation gaps.

*Snippet-curator:*

- `snippet-author.md` — composition conventions: naming patterns, arg-shape conventions, composable pairings.
- `forge.md` — selector vocabulary / framework patterns applied repeatedly.

## 3. Lead side — review and apply

Loaded by the lead only when at least one teammate reported `proposals: N > 0` and its `PROPOSALS` SendMessage(s) are in hand. You handle aggregation, user review, and application.

### 3.1. Aggregate proposals

Parse each `PROPOSALS` body (the §1 format). Collect across all teammates into a single list.

**Dedupe.** If two proposals (from different teammates) have substantially similar `OBSERVATION` AND target the same `CATEGORY`, merge: keep the one with more specific `EVIDENCE`; mention both proposing teammates in the displayed evidence.

### 3.2. Read current hint content for AMEND/REMOVE proposals

For each `AMEND`/`REMOVE`, read `<FORGE_ROOT>/hints/<CATEGORY>` and locate the `TARGET` text — needed for the diff preview (3.3) and application (3.4). If `TARGET` isn't found, mark **stale** (the file changed since the agent observed); quietly drop and continue.

### 3.3. Lint proposals

Walk each surviving proposal through two checks. Checks don't drop proposals — they tag them so 3.4 can offer an extra reject option naming the real problem.

**3.3a. Code-shaped content.** Inspect the content the proposal would introduce (`SUGGESTED_EDIT` for `ADD`, replacement text for `AMEND`). Flag as `code-shaped` if either holds: a fenced code block whose body exceeds 3 lines; or more than ~80 characters of indented monospace code outside a fence. Code-shaped content belongs in a snippet, not a hint. Don't drop — 3.4 surfaces an extra option to reject on the grounds the fix belongs in a snippet.

**3.3b. Cross-file duplication.** For each `ADD`, scan the *other* hint files (every `<FORGE_ROOT>/hints/*.md` except the proposal's `CATEGORY`) for substantially similar text — a selector, a named gotcha, a distinctive phrase. If a near-match exists, flag as `duplicates-elsewhere` and capture the matching file path + a short verbatim quote (~120 chars). 3.4 surfaces an extra option: "the text exists in the other file; move it instead." Don't perform the move — flagging is enough.

A proposal can carry both flags; both surface independently.

### 3.4. Surface to the user

Begin with this intro line (every time, even on repeated runs):

> **Hint proposals.** Patterns the team observed during this session that might be worth lifting into your project's hint files. Each is independent — accept what improves your hints, reject the rest.

Surface via `AskUserQuestion` with `multiSelect: true`. One option per proposal. Up to 4 proposals per question; for more, use multiple questions in the same call (up to 4 × 4 = 16 per call; a second call beyond that). **Single-proposal case**: single-select with Accept / Reject.

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

- `code-shaped`: sibling option **"Reject — should be a snippet fix"**, description: *"This proposal carries >3 lines of fenced code (or substantial indented code). Hints carry prose intent; executable shape belongs in a snippet. Selecting this rejects the proposal and signals the fix should land in a snippet instead."*
- `duplicates-elsewhere`: sibling option **"Move existing text instead"**, quoting the match and naming the file: *"`<other-file>` already contains: \"<verbatim quote ~120 chars>\". Selecting this rejects the proposal as-is and signals the existing text should be moved to `<CATEGORY>` rather than duplicated."* The lead does not perform the move — surfacing the conflict is the contract.

Single-proposal mode with flags: single-select with Accept + Reject + each applicable lint-flag option. In multi-select mode, lint-flag options are conceptually mutually exclusive with Accept for the same proposal but technically independent checkboxes — if the user ticks both, prefer the lint-flag option and note the conflict in the application summary.

### 3.5. Apply accepted proposals

For each accepted proposal:

1. Re-read the target hint file (line numbers may have shifted from prior accepts).
2. Apply:
   - **`ADD`**: locate the matching heading and append `SUGGESTED_EDIT` under it. No matching section → new section at end of file. File doesn't exist → create it.
   - **`AMEND`**: find the exact `TARGET` text and replace with `SUGGESTED_EDIT`.
   - **`REMOVE`**: find the exact `TARGET` text and remove it.
3. If `TARGET` can't be found at application time, warn the user and skip: *"Proposal '<label>' target text not found in <file>; skipping."*

Apply in order; re-read between each to handle shifting offsets.

### 3.6. Hand back

Build a one-line-per-file summary:

```
forge/hints/driver.md         (+2 sections: <names>)
forge/hints/snippet-author.md (+1 amendment, +1 new section)
```

Return to `team-task.md` Phase 5 for the "Hint files updated" line in the final report. Omit the line if nothing was accepted.

**Lead-side hard rules:**

- **Apply changes only after the user accepts via AskUserQuestion.** Never apply silently.
- **Don't modify any file outside `<FORGE_ROOT>/hints/<X>.md`.** Snippets, specs, plugin files are out of scope.
- **Don't propose or apply hints about forge's own behavior** — only the project's app/conventions. (Defense-in-depth; the producer should already have filtered.)
- **Empty proposals don't reach you** — Phase 4.5 filters the all-zero case. If you arrive with zero after parsing, exit quietly.
