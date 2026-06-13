# widgets / run-2 — comprehensive hints

**Hint set in place:** `hints/driver.md` with a 14-widget probe map, ad-occlusion / `scrollIntoViewIfNeeded` note, Kendo-intercept warning for date pickers, manual-mouse-event pattern for drag-drop family.

Working tree wiped before this run so the comparison with `run-1/` is apples-to-apples — same five widgets, same prompts, fresh snippet library.

## Results

All five widgets drove cleanly. Seven snippets authored — two widgets split compositionally:

| Widget | Snippet(s) | Δ vs run-1 |
|---|---|---|
| `/text-box` | `fill-text-box-form.ts`, `get-text-box-output.ts` | Both phases split into fill + read-output. Run-2 named the second snippet more narrowly (`get-text-box-output` vs `submit-text-box-and-capture-output`) — easier to compose without an implicit submit. |
| `/date-picker` | `select-date-picker-date.ts` | Same `{month, year, day}` parameterisation as run-1. Run-2 added scroll-into-view safety. |
| `/auto-complete` | `add-multi-autocomplete-colors.ts`, `get-multi-autocomplete-chips.ts` | Run-1 produced one snippet. Run-2 split into add + get-chips. Future test that wants to "add colors but assert different chip behaviour" can compose these independently. |
| `/sortable` | `drag-sortable-item.ts` | Run-1 args: `{item, afterItem}` (text-based). Run-2 args: `{listSelector, itemText, targetIndex}` — more generic, works with any jQuery-UI sortable list. |
| `/modal-dialogs` | `open-capture-close-modal.ts` | Run-1 was small-modal-only. Run-2 parameterised on `size` ('small'/'large') using the `show{Size}Modal` / `close{Size}Modal` ID convention the hint flagged. Real coverage lift. |

## What this tells you

The hint set didn't change which probes passed (run-1 already passed everything). It changed:

- **Snippet parameterisation.** Hint-flagged variants (modal `size`, sortable `listSelector`) became `args` instead of hardcoded values. The snippets cover more cases.
- **Snippet decomposition.** Where snippet-author had instinctively split text-box in run-1, the hint's selector inventory extended the same instinct to autocomplete in run-2. The library has more single-responsibility pieces.
- **Defensive code.** Phase 2 snippets added `scrollIntoViewIfNeeded()` calls in places where the hint's ad-occlusion warning applied. The snippets are more robust against the page's specific quirks.

This is what comprehensive hints buy you on a target where the bare driver already handles the interactions: **a snippet library that's wider in coverage, more compositional in shape, and more defensive against documented edge cases**.

## Artifacts

- `hints/driver.md` — the comprehensive hint set
- `snippets/` — 7 snippets across 5 widgets
