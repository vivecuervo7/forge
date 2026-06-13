# widgets / run-1 — bare-minimum hints

**Hint set in place:** none. Widget pages are public; no auth needed.

## Widgets driven

| Widget | Class | Drive prompt |
|---|---|---|
| `/text-box` | Baseline form | `open demoqa.com/text-box, fill the form with sample values, and capture the rendered output panel` |
| `/date-picker` | React date widget | `open /date-picker, open the Select Date input, navigate to December 2026, and select the 25th` |
| `/auto-complete` | Tag/chip input | `open /auto-complete and add the colors Red, Blue, and Green to the multi-color autocomplete` |
| `/sortable` | Drag-reorder list | `open /sortable and drag the "One" item down so the list reads Two, Three, One` |
| `/modal-dialogs` | Modal lifecycle | `open /modal-dialogs, open the small modal, capture its content, and close it` |

## Results

All five drove cleanly. Six snippets authored — the text-box widget produced two:

| Widget | Snippet(s) | Notes |
|---|---|---|
| `/text-box` | `fill-text-box-form.ts`, `submit-text-box-and-capture-output.ts` | Snippet-author voluntarily split into fill + submit-and-capture rather than fusing them. Compositional. |
| `/date-picker` | `select-date-picker-date.ts` | Used `.react-datepicker__month-select` / `.react-datepicker__year-select` plus a gridcell role-name match. Args: `{month, year, day}`. |
| `/auto-complete` | `add-colors-to-multi-autocomplete.ts` | Loops `args.colors`, fills input, waits 500ms for dropdown, clicks first option. Returns chip labels for assertion. |
| `/sortable` | `drag-sortable-list-item.ts` | Used incremental `mouse.move/down/up` (not `dragTo`) for the jQuery-UI-style sortable. Args: `item`, `afterItem` by text. |
| `/modal-dialogs` | `open-capture-close-small-modal.ts` | Open + capture title/body + close + wait for hidden. |

## What this tells you

Two patterns worth noticing across the bare-driver output:

1. **The driver picked the right primitive for each widget family.** React date picker: native `<select>` for month/year, gridcell for day. Sortable: manual mouse sequence (jQuery UI needs continuous motion to trigger reorder). Autocomplete: fill → wait → click first option. These are non-obvious choices; the agent's defaults already cover them.
2. **Snippet-author splits along compositional boundaries on its own.** Text-box's fill-vs-submit split wasn't asked for — snippet-author identified that someone might want to fill without submitting (e.g., a future test that validates inline errors). The library is more reusable as a result.

The compositional split is the pattern run-2 amplifies via hint-driven selector vocabulary. See `run-2/README.md`.

## Artifacts

- `snippets/` — 6 snippets across 5 probes
- No `hints/driver.md` (this was the bare-minimum run)
