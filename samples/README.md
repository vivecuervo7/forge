# Forge samples

Three exemplar forge setups, each one a `forge/`-shaped directory you can read directly to see what good hint authoring looks like for a particular kind of site.

| Sample | Target | What it exemplifies |
|---|---|---|
| [`shop/`](./shop) | [practicesoftwaretesting.com](https://practicesoftwaretesting.com) | Auth + multiple test accounts. Includes the account-table hint pattern, the shell-expansion convention for env-sourced credentials, and a `.env.example`. **Read this one first if your project has authentication.** |
| [`internet/`](./internet) | [the-internet.herokuapp.com](https://the-internet.herokuapp.com) | Small isolated interaction patterns — dialogs, drag-and-drop, shadow DOM, async loading. No auth. Shows what a `driver.md` looks like when the project is a probe-shaped surface rather than a transactional app. |
| [`widgets/`](./widgets) | [demoqa.com](https://demoqa.com) | Legacy-widget gauntlet — Kendo, jQuery UI sortable, React date pickers, Bootstrap modals. Shows how to encode UI-library quirks into hints. |

## What's in each sample

Each sample directory is shaped like a `forge/` directory post-`/forge init`. The files committed to this repo:

- `hints/` — the authored hints (`forge.md`, `driver.md`) demonstrating what good hint authoring looks like for this kind of site.
- `.gitignore`, `playwright.config.ts` — the scaffolded files `/forge init` would create.
- `README.md` — meta-documentation explaining why this sample is the exemplar it claims to be.
- `.env.example` (shop only) — the env keys the account-table references.

What's **not** committed (gitignored, populated by `/forge` invocations):

- `snippets/` — produced by `forge:snippet-author` during drives.
- `specs/` — produced by `forge:spec-writer` during spec-mode runs.
- `videos/`, `node_modules/`, `package.json`, etc. — local working state.

The snippets and specs are deliberately absent from the committed repo. **They're the result of running forge against the target** — and the value of seeing them in the samples comes from them being real forge output, not hand-edited approximations. When you run `/forge` against one of these targets (or a similar app in your own project), you'll get the artifacts that justify why the hint set produced them.

## How to use these samples for your own project

1. **Pick the closest match.** Shop for auth-bearing apps; internet for probe-shaped public sites; widgets for legacy-UI-library-heavy sites.
2. **Read the chosen sample's `README.md` and `hints/`.** Note the structure — account tables in `forge.md`, selector inventories and gotchas in `driver.md`. Adapt the structure to your project.
3. **Author your own `forge/hints/{forge,driver}.md`** following the same shape. The smaller hint files (`snippet-author.md`, `spec-writer.md`, `spec-verifier.md`) are usually unnecessary; the agent defaults cover them.
4. **Run forge.** Drive a task; the snippet-author accretes a library; spec-mode adds verified specs on top. The artifacts in your project's `forge/snippets/` and `forge/specs/` will look qualitatively like what these samples would produce when run.

