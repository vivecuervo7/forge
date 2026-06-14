# Forge samples

Three exemplar forge setups, each one a `forge/`-shaped directory you can read directly to see what good hint authoring looks like for a particular kind of site. Each sample includes a few seeded snippets — real forge output — and a walkthrough that has you run forge yourself to watch the library grow.

| Sample | Target | What it exemplifies |
|---|---|---|
| [`shop/`](./shop) | [practicesoftwaretesting.com](https://practicesoftwaretesting.com) | Auth + multiple test accounts. Includes the account-table hint pattern, a `.env.example`, and a four-step walkthrough covering library reuse, new authoring, spec mode, and teach mode. **Read this one first if your project has authentication.** |
| [`internet/`](./internet) | [the-internet.herokuapp.com](https://the-internet.herokuapp.com) | Small isolated interaction patterns — dialogs, drag-and-drop, shadow DOM, async loading. No auth. Shows variant-arg parameterisation. |
| [`widgets/`](./widgets) | [demoqa.com](https://demoqa.com) | Legacy-widget gauntlet — Kendo, jQuery UI sortable, React date pickers, Bootstrap modals. Shows compositional decomposition (fill + read pairs). |

## What's in each sample

Each sample directory is shaped like a `forge/` directory after `/forge init` plus a couple of real forge runs:

- `hints/` — the authored hints (`forge.md`, `driver.md`) demonstrating what good hint authoring looks like for this kind of site.
- `playwright.config.ts` — the scaffolded fallback Playwright config `/forge init` would create.
- `snippets/` — seeded with a small set of real forge output. The walkthrough builds on these.
- `README.md` — meta-documentation explaining what the sample demonstrates, plus the walkthrough.
- `.env.example` (shop only) — the env keys the account-table references, with the seeded demo credentials filled in.

Everything not committed (gitignored, populated automatically when you run forge):

- New `snippets/` entries beyond the seeded ones — produced by `forge:snippet-author` during your drives.
- `specs/` — produced by `forge:spec-writer` during your spec-mode runs.
- `node_modules/` + `package.json` — Playwright runner deps. Forge lazy-installs them on first invocation (~30s, one-time per sample). No manual `npm install` needed.
- `videos/`, `test-results/`, `.env` — local working state and your filled-in credentials.

## How to use these samples for your own project

1. **Pick the closest match.** Shop for auth-bearing apps; internet for probe-shaped public sites; widgets for legacy-UI-library-heavy sites.
2. **Read the chosen sample's `README.md` and `hints/`.** Note the structure — account tables in `forge.md`, selector inventories and gotchas in `driver.md`. Adapt the structure to your project.
3. **Walk through the prompts.** Each sample's README has a sequence of `/forge` invocations that demonstrate library reuse, new authoring, spec mode, and (for shop) teach mode. Run them. Watch the library grow.
4. **Author your own `forge/hints/{forge,driver}.md`** following the same shape against your project. The smaller hint files (`snippet-author.md`, `spec-writer.md`, `spec-verifier.md`) are usually unnecessary; the agent defaults cover them.
5. **Run forge against your project.** Drive a task; the snippet-author accretes a library; spec-mode adds verified specs on top.
