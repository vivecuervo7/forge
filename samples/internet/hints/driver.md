# Project hint: forge:driver

Consumed by `forge:driver` when driving against the-internet.herokuapp.com.

## What this project is

A directory of automation-testing probe pages, one per interaction class. Each page is small and self-contained. Use forge to drive each probe once and capture how cleanly it handled the surface.

## Origin

`https://the-internet.herokuapp.com`. The homepage at `/` lists every probe page; the link text matches the probe name.

## Probe map

Pages we care about for boundary-mapping, grouped by interaction class:

| Probe | Path | Class | Why interesting |
|---|---|---|---|
| Login (form auth) | `/login` | Auth | Sanity check — standard form, semantic locators. Should pass cleanly. |
| Dynamic Loading | `/dynamic_loading/1`, `/dynamic_loading/2` | Async rendering | Element appears after a delay. Tests forge's patience / waitFor discipline. |
| JavaScript Alerts | `/javascript_alerts` | Native dialog | Confirm / prompt dialogs. Playwright handles via `page.on('dialog', …)` — forge has to set that up before the click. |
| Frames | `/frames` (then `/nested_frames` or `/iframe`) | iframe | Locators must descend into the frame. Pure Playwright works; the question is whether the driver figures it out without prompting. |
| Dynamic Controls | `/dynamic_controls` | Enable/disable toggles | A button toggles a checkbox from disabled → enabled with a loading bar. Same patience class as Dynamic Loading. |
| Drag and Drop | `/drag_and_drop` | HTML5 DnD | Notoriously bad for automation. HTML5 native drag-drop doesn't fire on Playwright's `dragTo` reliably — needs `dispatchEvent` workarounds. Strong falter candidate. |
| Hovers | `/hovers` | Hover-reveal | Avatar overlays appear on hover. Playwright `hover()` is the standard tool. |
| Shadow DOM | `/shadowdom` | Shadow root | Locators need `>>` shadow descent. Tests forge's selector picker. |
| WYSIWYG Editor | `/tinymce` | Rich editor inside iframe | Combines iframe descent + contentEditable. Hard. |
| File Upload | `/upload` | OS-level upload | Playwright `setInputFiles`. Requires a sample file on disk. |
| File Download | `/download` | Browser download | The link triggers a real download; assertion checks the file lands on disk. |
| Infinite Scroll | `/infinite_scroll` | Lazy-load on scroll | Tests whether forge knows to scroll to trigger more content. |

## Strategy

One probe per drive — narrow tasks. Examples:

- `/forge open /login and sign in as tomsmith / SuperSecretPassword!`
- `/forge open /drag_and_drop and swap boxes A and B`
- `/forge open /javascript_alerts and accept the second alert, capture the result text`

Then doc which ones passed cleanly, which needed STUCK / driver judgment, which couldn't complete.

## Known gotchas

- **The pages render minimal markup with no `data-test` attributes.** Locators rely on `#id`, `text=`, or `role=` — semantic locators usually work but expect more enumeration than saucedemo.
- **Drag-and-drop on `/drag_and_drop` uses HTML5 native events.** Playwright's `dragTo` often fails silently; `page.dispatchEvent` with manufactured `DragEvent` is the reliable path.
- **TinyMCE on `/tinymce` is an iframe-hosted contentEditable.** The `body` inside the frame is the target — `frameLocator('#mce_0_ifr').locator('body').fill(...)` is the shape.
- **Alerts must be wired before the click.** `page.once('dialog', d => d.accept())` then click the trigger. If you click first, the alert blocks and the listener has nothing to attach to.

## Login credentials (only for /login probe)

Posted directly on the page itself, no env injection needed:

- Username: `tomsmith`
- Password: `SuperSecretPassword!`

These are public-by-design; quoting them inline in a snippet is fine. Forge's "no credential literals" rule applies to real credentials — these are the page's documentation.
