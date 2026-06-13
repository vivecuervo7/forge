# internet — the-internet.herokuapp.com

[the-internet.herokuapp.com](https://the-internet.herokuapp.com) is an automation-testing playground that exposes each classic-hard browser interaction on its own page (alerts, frames, drag-and-drop, dynamic loading, shadow DOM, etc.). Each page is small and self-contained, which makes it a clean target for asking "how does forge handle X interaction class?" without confounding factors.

## Runs

- [`run-1/`](./run-1) — **bare-minimum hints.** No hint files at all; the site is fully public and needs no auth.
- [`run-2/`](./run-2) — **comprehensive `driver.md`.** Probe map, per-probe gotchas, dialog-listener pattern, drag-and-drop notes.

## What to expect

Both runs drove the same five probes: `/login`, `/dynamic_loading/1`, `/javascript_alerts`, `/drag_and_drop`, `/shadowdom`. These cover auth, async rendering, native dialogs, HTML5 drag-and-drop, and shadow DOM respectively — the interaction classes that historically gave automation frameworks trouble.

The interesting comparison isn't "did forge pass?" — it did on every probe in both runs. The interesting comparison is **what the snippets look like**:

- Run-1 snippets are scoped tightly to the exact value the driver encountered. `accept-js-confirm-alert` accepts the alert and reads `#result`, end of story.
- Run-2 snippets are parameterised along dimensions the hint flagged as interesting variants. `javascript-alerts-confirm-and-capture` takes a `dialogAction` arg ('accept' or 'dismiss'); `dynamic-loading-start-and-capture` takes a `variant` arg covering both `/dynamic_loading/1` and `/2`.

Read `run-1/snippets/` and `run-2/snippets/` side by side to see the difference compose into the library shape.
