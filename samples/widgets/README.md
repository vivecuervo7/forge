# widgets — demoqa.com

[demoqa.com](https://demoqa.com) is a widget catalogue — each page hosts one widget class with a demo (React date picker, jQuery UI sortable, Bootstrap modal, autocomplete chips, hierarchical checkbox tree, etc.). It stands in for older enterprise web apps without committing to a specific named product. The pages are noisier than the-internet — ads, fixed-position banners, more chrome — which makes selector discovery harder.

## Runs

- [`run-1/`](./run-1) — **bare-minimum hints.** No hint files; widget pages are public.
- [`run-2/`](./run-2) — **comprehensive `driver.md`.** 14-widget probe map, ad-occlusion / `scrollIntoViewIfNeeded` note, Kendo-intercept warning for the date picker, manual mouse-event pattern for the drag-drop family.

## What to expect

Both runs drove the same five widgets: `/text-box`, `/date-picker`, `/auto-complete`, `/sortable`, `/modal-dialogs`. The widget classes here are more idiosyncratic than internet's — calendar UI navigation, drag-reorder with mouse-move sequences, fill-then-wait-then-pick patterns for autocomplete.

Notable patterns visible in the snippets:

- **The driver picked the right primitive for each widget family without prompting.** Calendar UI navigation via the month/year `<select>` elements, not a `.fill()` of the input. Sortable drag via incremental `mouse.move/down/up`, not `dragTo` (which doesn't trigger jQuery UI's mousemove-driven reorder logic). Autocomplete via fill → 500ms wait → click first option, not just fill-and-tab.
- **Snippet compositionality emerged on the text-box widget even in run-1.** Snippet-author voluntarily split into `fill-text-box-form` + `submit-text-box-and-capture-output` rather than fusing them. The split makes a future "fill, then validate validation errors before submitting" test trivially possible. Run-2 carried this pattern further by splitting autocomplete into `add-multi-autocomplete-colors` + `get-multi-autocomplete-chips`.
- **Run-2's `driver.md` listed every selector by element class.** Compare `run-1/snippets/select-date-picker-date.ts` (uses `.react-datepicker__month-select` discovered ad-hoc) with `run-2/snippets/select-date-picker-date.ts` (same selector but parameterised more cleanly). Same correctness, different reusability.
