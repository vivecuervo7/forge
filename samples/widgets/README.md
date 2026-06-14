# widgets — exemplar for legacy-widget-heavy apps

This sample is a `forge/`-shaped directory showing what a good setup looks like for a site with legacy UI libraries — Kendo widgets, jQuery UI sortable, React date pickers, Bootstrap modals, autocomplete chips. The target is [demoqa.com](https://demoqa.com), a deliberately-built widget gauntlet with ad clutter to boot.

**If your project uses any of those libraries (or component libraries with similar quirks — MUI, AntD, etc.), mirror this sample** for how to encode UI-library gotchas into hints.

## What's here

| File | Purpose |
|---|---|
| [`hints/driver.md`](./hints/driver.md) | A 14-widget probe map, an ad-occlusion / `scrollIntoViewIfNeeded` rule, Kendo-intercept warnings for date pickers, the manual-mouse-event pattern for the drag-drop family. **Shows what a `driver.md` looks like when the app's UI library is the source of pain.** |
| `playwright.config.ts` | Scaffolded by `/forge init`. |
| `.gitignore` | Scaffolded by `/forge init`. |

## What's not here yet

The `snippets/` directory will be populated when you run forge against this target. To generate it yourself, drive any of the widgets:

```
cd samples/widgets
/forge fill the text-box form with sample data and capture the output
/forge select a date in the date picker
/forge add three colour chips to the autocomplete and capture them
/forge drag the second item to the fourth position in the sortable list
/forge open the large modal, capture its title, close it
```

Watch how the snippet-author splits compositionally where the hint's structure suggests boundaries — text-box and autocomplete each split into fill + read pairs, modal parameterises on size, sortable parameterises on list selector.

## What this exemplar demonstrates

**Hint quality compounds in two directions: parameterisation and decomposition.** A hint's selector inventory plus variant documentation drives snippet-author to:

- **Parameterise.** Modal `size`, sortable `listSelector` — variants the hint names become snippet args. The library covers more cases without growing more snippets.
- **Decompose.** Text-box and autocomplete each become two snippets (fill + read, add + get) rather than one fused snippet. Future tests compose them; the library is more reusable.
- **Defend.** `scrollIntoViewIfNeeded()` calls land where the hint warns about ad occlusion. The snippets are more robust against documented edge cases without needing instruction at the spec layer.

The hint set doesn't change which probes pass (the bare driver already handles them). It changes the *shape* of the library forge produces — and library shape determines whether future specs compose cleanly or have to inline everything.

## How to read this sample for your own project

1. **Open `hints/driver.md`** and notice the structure: per-widget entries that include both selectors and library-specific gotchas (the Kendo intercept, the ad-occlusion rule, the `dragTo` unreliability). When your app uses a UI library with quirks, that's where they belong.

2. **When you author hints,** name variants you want snippet-author to parameterise over. "There are two modal sizes" → snippet takes a `size` arg. "Three colour chips" → snippet takes a `colours` array. The hint's vocabulary becomes the snippet's args.

3. **For auth-bearing scenarios**, see the [shop sample](../shop/) — this target has no auth.

## Why this hint shape — findings from earlier runs

Earlier forge runs against this target (design-phase field tests) gave us evidence for several choices the hint encodes:

- **Hint-driven decomposition.** Where the hint's selector inventory named separate concerns (text-box fill vs read output, autocomplete add vs get-chips), snippet-author authored separate snippets rather than fusing them. Future tests compose them; the library is more reusable. Without the hint's vocabulary, snippet-author tends to fuse along the boundaries of the user's instruction — one snippet per drive instruction, even when the natural reusable unit is smaller.

- **Defensive code lands where hints warn.** With the ad-occlusion / `scrollIntoViewIfNeeded()` rule documented in the hint, snippets produced from drives include the safety call. Without it, the snippets are fragile against the page's ad clutter — they work the day they're written, then occasionally fail later as the ad layout changes. The hint converts an observed flake into a structural defence in every snippet that touches the affected widgets.

- **Hint-driven parameterisation against UI-library variants.** Modal `size` (small / large), sortable `listSelector` — variants the hint names become snippet args, so a single snippet covers each widget's variant space rather than producing one snippet per variant.

- **The patterns transfer across UI libraries.** The hint's "manual mouse events for drag-drop" rule and "Kendo intercept on date pickers" warning have analogues in MUI, AntD, and most legacy-feeling component libraries. The hint shape — per-widget entries combining selectors with library quirks — is reusable even if your app uses none of the specific libraries this target does.
