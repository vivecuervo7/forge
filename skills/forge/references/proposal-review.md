# /forge — proposal-review reference

This reference is loaded on-demand by the lead (from `team-task.md` or `teach.md`) **only when at least one teammate has reported proposals to review**. It is not pre-loaded — skipping it entirely is the right behavior when all teammates report `proposals: 0`.

The caller (the lead, following team-task.md or teach.md) has already:

- Confirmed at least one teammate reported `proposals: N > 0`.
- Received `PROPOSALS` SendMessages from those teammates.
- Captured `PLUGIN_ROOT` and `FORGE_ROOT` from earlier phases.

You're being loaded to handle aggregation, user review, and application.

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

**Dedupe.** If two proposals (from different teammates) have substantially similar `OBSERVATION` text AND target the same `CATEGORY`, merge them: take the one with more specific `EVIDENCE`; mention both proposing teammates in the displayed evidence.

## 2. Read current hint content for AMEND/REMOVE proposals

For each proposal with `ACTION=AMEND` or `ACTION=REMOVE`, read the target hint file at `<FORGE_ROOT>/hints/<CATEGORY>` and locate the `TARGET` text. You need this both for the diff preview (step 3) and the application step (step 4).

If a `TARGET` can't be found in the file, mark the proposal as **stale** — the file has changed since the agent observed. Don't surface it; quietly drop and continue with the rest.

## 3. Surface to the user

Begin with this intro line (every time, even on repeated runs):

> **Hint proposals.** Patterns the team observed during this session that might be worth lifting into your project's hint files. Each is independent — accept what improves your hints, reject the rest.

Then surface the proposals via `AskUserQuestion` with `multiSelect: true`. One option per proposal. Group up to 4 proposals per question; if you have more than 4, use multiple questions in the same `AskUserQuestion` call (up to 4 questions × 4 options = 16 proposals per call; for more, make a second call after).

**Single-proposal special case**: if there's exactly one proposal, use single-select (`multiSelect: false`) with two options: Accept / Reject. Multi-select is reserved for 2+ options.

**Option label**: short, identifies the proposal (e.g., `"FORGE_BASE_URL env contract"`, `"Universal dispatchEvent pattern"`).

**Option description**: carries the meaningful content. Include:

- `[<ACTION> <CATEGORY>]` prefix
- The `OBSERVATION`
- The `EVIDENCE` (one-line summary)
- For `ADD`: the `SUGGESTED_EDIT` prose (first ~200 chars; user reads detail at decision time)
- For `AMEND`: an inline diff showing existing `TARGET` prose → `SUGGESTED_EDIT` (use `→` or `replaces` notation)
- For `REMOVE`: an inline indication of what gets deleted (`removes: <TARGET first ~100 chars>`)
- If `ALTERNATIVES` present, list them as sub-bullets in the description

For `AMEND` and `REMOVE` proposals, **always show the existing prose alongside the proposed change** in the option description. The user accepts blind otherwise.

## 4. Apply accepted proposals

For each proposal the user selected:

1. Re-read the target hint file (line numbers may have shifted from prior accepts).
2. Apply the change:
   - **`ADD`**: locate the appropriate heading (matching the proposal's `TARGET` if provided) and append the `SUGGESTED_EDIT` under it. If no `TARGET` section exists, create a new section at the end of the file. If the file doesn't exist (all hint files are optional), create it.
   - **`AMEND`**: find the exact `TARGET` text and replace with `SUGGESTED_EDIT` using the Edit tool.
   - **`REMOVE`**: find the exact `TARGET` text and remove it.
3. If a `TARGET` can't be found at application time (file changed mid-loop), surface a warning to the user and skip that proposal: *"Proposal '<label>' target text not found in <file>; skipping."*

Apply proposals in the order they appear; re-read between each to handle shifting offsets.

## 5. Hand back to the caller

After applying, build a one-line-per-file summary of changes:

```
forge/hints/driver.md       (+2 sections: <names>)
forge/hints/snippet-author.md (+1 amendment, +1 new section)
```

Return this summary to the caller (the lead's `team-task.md` Phase 5 or `teach.md` Phase 6). They use it in the final report under a "Hint files updated" line. If no proposals were accepted, the line is omitted.

## Hard rules

- **Apply changes only after user accepts via AskUserQuestion.** Never apply silently.
- **Don't modify any file outside `<FORGE_ROOT>/hints/<X>.md`.** Snippet files, spec files, plugin files are not in scope.
- **Don't propose or apply hints about forge's own behavior** — only the project's app/conventions. (The proposing agent should have filtered this; defense-in-depth here.)
- **Empty proposals don't reach you** — the caller already filtered out the all-zero case. If you somehow arrive here with zero proposals after parsing, exit quietly without surfacing anything.
