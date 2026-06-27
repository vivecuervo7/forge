# widgets — exemplar for legacy-widget-heavy apps

This sample is a project shaped like one that's had `/forge init` run on it — a `forge/` subdir with the hints, a config, and (once you run forge against it) snippets. The target is [demoqa.com](https://demoqa.com), a deliberately-built widget gauntlet with legacy UI libraries — Kendo widgets, jQuery UI sortable, React date pickers, Bootstrap modals, autocomplete chips — plus ad clutter.

**If your project uses any of those libraries (or component libraries with similar quirks — MUI, AntD, etc.), mirror this sample.**

## What's here

| File | Purpose |
|---|---|
| [`forge/hints/driver.md`](./forge/hints/driver.md) | A 14-widget probe map, an ad-occlusion / `scrollIntoViewIfNeeded` rule, Kendo-intercept warnings for date pickers, the manual-mouse-event pattern for the drag-drop family. **Shows what a `driver.md` looks like when the app's UI library is the source of pain.** |
| `forge/playwright.config.ts` | Scaffolded by `/forge init`. |
| `forge/snippets/fill-text-box-form.ts` | **Seeded** — produced by a real forge run. Navigates to the text-box page and fills the four form fields from args. |
| `forge/snippets/submit-text-box-form.ts` | **Seeded** — produced by the same run. Clicks Submit and returns the rendered output panel text. The compositional pair to `fill-text-box-form`. |

## Walkthrough — see compositional decomposition in action

Run these from inside `samples/widgets/`.

### 1. Library reuse — both halves of the pair invoke cleanly

```
/forge open the text-box page, fill the form, submit, and capture the output
```

The driver invokes both seeded snippets in sequence: `fill-text-box-form` for the fill, `submit-text-box-form` for the submit + read. No new authoring.

**What to look for:**
- The driver logs two `invoked …` steps; the curator sees them in the trace and authors nothing new.
- `forge/snippets/` is unchanged after the run.

**What this demonstrates:** when a UI workflow has natural composable boundaries (fill vs read here), the curator writes one snippet per concern, and future tasks compose them. The seeded library already encodes the pair; the user's task is satisfied by invoking, not authoring.

### 2. Drive a different widget — see decomposition emerge fresh

```
/forge open the autocomplete page, add three colour chips, then capture the chip list
```

Another natural pair — add and read. The curator writes two snippets, not one.

**What to look for:** two new snippets in `forge/snippets/` (one for adding, one for reading).

**What this demonstrates:** library decomposition is consistent. The hint's structure suggests boundaries; the curator follows them every time.

### 3. Optional — drive any of the other widgets

```
/forge select a date in the date picker
/forge drag the second item to the fourth position in the sortable list
/forge open the large modal, capture its title, close it
```

Each adds a parameterised snippet. The modal snippet should take `size` as an arg (small / large); the sortable should take `listSelector` + `itemText` + `targetIndex`. The hint names the variants; the curator parameterises along them.

## Why this hint shape — findings from earlier runs

Earlier forge runs against this target (design-phase field tests) gave us evidence for several choices the hint encodes:

- **Hint-driven decomposition.** Where the hint's selector inventory named separate concerns (text-box fill vs read output, autocomplete add vs get-chips), the curator authored separate snippets rather than fusing them. Future tests compose them; the library is more reusable. Without the hint's vocabulary, the curator tends to fuse along the boundaries of the user's instruction — one snippet per drive instruction, even when the natural reusable unit is smaller.

- **Defensive code lands where hints warn.** With the ad-occlusion / `scrollIntoViewIfNeeded()` rule documented in the hint, snippets produced from drives include the safety call. Without it, the snippets are fragile against the page's ad clutter — they work the day they're written, then occasionally fail later as the ad layout changes. The hint converts an observed flake into a structural defence in every snippet that touches the affected widgets.

- **Hint-driven parameterisation against UI-library variants.** Modal `size` (small / large), sortable `listSelector` — variants the hint names become snippet args, so a single snippet covers each widget's variant space rather than producing one snippet per variant.

- **The patterns transfer across UI libraries.** The hint's "manual mouse events for drag-drop" rule and "Kendo intercept on date pickers" warning have analogues in MUI, AntD, and most legacy-feeling component libraries. The hint shape — per-widget entries combining selectors with library quirks — is reusable even if your app uses none of the specific libraries this target does.

## For auth-bearing scenarios

This target has no auth. See the [shop sample](../shop/) for the auth + multi-account pattern.
