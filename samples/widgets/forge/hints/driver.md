# Project hint: forge:driver

Consumed by `forge:driver` when driving against demoqa.com.

## What this project is

A widget catalogue — each page hosts one widget class (datepicker, draggable, sortable, accordion, dialog, slider, etc.) with a brief demo. The pages render heavy chrome (ads, breadcrumbs, sidebar nav) that's mostly irrelevant; focus narrowly on the widget under test.

## Origin

`https://demoqa.com`. The homepage lists six top-level categories (Elements, Forms, Alerts & Frames, Widgets, Interactions, Book Store). Each opens a left-rail menu with the per-widget pages.

## Probe map

Pages worth driving, grouped by interaction class:

| Probe | Path | Class | Why interesting |
|---|---|---|---|
| Text Box | `/text-box` | Baseline form | Sanity check — multi-field form with output panel. Should pass cleanly. |
| Check Box | `/checkbox` | Hierarchical tree | Tri-state tree of checkboxes (jstree). Selecting one cascades to children; output panel lists selected leaves. |
| Date Picker | `/date-picker` | Calendar widget | Kendo-style datepicker with month/year dropdowns. Hard — calendar popup, can't just `fill` the input in most cases. |
| Auto Complete | `/auto-complete` | Tag/chip input | Type → suggestions appear → click to add as chip. Tests forge's "wait for suggestion, then pick" sequencing. |
| Slider | `/slider` | Range input | HTML5 `input[type=range]` — `fill` doesn't work; use `evaluate` to set value and dispatch `input` event. |
| Progress Bar | `/progress-bar` | Animated state | Start button kicks off a 10s progress fill. Tests patience + final-state assertion. |
| Tool Tips | `/tool-tips` | Hover-reveal | Tooltip text only renders on hover. Tests `hover()` then read. |
| Menu | `/menu` | Nested hover menu | Multi-level dropdown that opens on hover, not click. |
| Dialogs (Modal) | `/modal-dialogs` | Modal | Trigger opens a Bootstrap modal; close via X button or `Close` button. Tests modal lifecycle. |
| Sortable | `/sortable` | List drag-reorder | jQuery UI sortable. HTML5 drag-drop semantics. Strong falter candidate. |
| Selectable | `/selectable` | List multi-select | Click-to-select pattern. Easier than sortable. |
| Resizable | `/resizable` | Drag-to-resize box | Drag the bottom-right handle. Falter candidate (same drag-drop class). |
| Droppable | `/droppable` | Drag-onto-target | Drag the source onto the drop zone — fires text/style change on drop. Falter candidate. |
| Dragabble | `/dragabble` (typo is theirs) | Free drag | Position-based; less semantic. Falter candidate. |

## Strategy

One probe per drive. Suggested tasks:

- `/forge open /date-picker and select 25 December 2026 in the Select Date input`
- `/forge open /auto-complete and add 'Red', 'Blue', 'Green' as colors`
- `/forge open /sortable and reverse the order of the default list`
- `/forge open /progress-bar, start it, and capture the final 'Reset' state`

Then doc which passed / faltered / blocked.

## Known gotchas

- **Persistent ad/banner clutter.** Most pages render Google ads + a fixed-position banner that can occlude controls. Playwright clicks usually work anyway (they use coordinates), but if a click misses, try `scrollIntoViewIfNeeded` first.
- **Iframes from ads.** Some pages have iframes for ad slots that confuse `frameLocator` if you assume there's only the target widget's frame. Filter by the widget's frame name/URL.
- **No `data-test` attributes anywhere.** Locators rely on `#id`, `.class`, `text=`, or `role=`. The page source is the documentation.
- **Date picker is two-step.** Open the popup, then click the date. `page.locator('#datePickerMonthYearInput').fill('12/25/2026')` does NOT work — Kendo intercepts. Use the calendar UI.
- **Drag-drop widgets need `dispatchEvent` workarounds.** jQuery UI listens for synthetic mouse events; Playwright's `dragTo` is unreliable. Manual `mousedown` → `mousemove` → `mouseup` with explicit positions is the reliable pattern.
