# /forge — init reference

Loaded by `/forge`'s router for the **init** route. The router stripped the `init` keyword; the remaining text (possibly empty) is an optional target directory.

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below — substitute the literal path captured in SKILL.md phase 1.0. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in this bash context.

## What this route does

Scaffolds the canonical `forge/` layout into a project. Run once at the start of using forge against a new project; sets up the directory and writes hint-authoring guidance.

## What gets created

```
<target-dir>/
└── forge/
    ├── .gitignore          # gitignored: self-documenting policy (matched by its own `*`)
    ├── README.md           # gitignored: points at the conventions doc
    ├── playwright.config.ts # gitignored: fallback Playwright config
    └── hints/              # tracked: the hint files are the only forge content in version control
        ├── forge.md        # tracked: empty stub — operate hint (lead + driver); you fill it in
        ├── curator.md      # tracked: empty stub — snippet conventions (curator); usually stays empty
        └── README.md       # gitignored: local guidance for authoring hints
```

The two hint files are scaffolded **empty** (a one-line comment pointing at `README.md`) so the names forge loads are pre-created — a user fills them in rather than guessing the filename. Empty = forge uses its defaults.

Everything else under `forge/` (snippets, specs, videos, transcripts) is created lazily by other routes. After scaffolding, the user authors hint files in `forge/hints/`.

Env handling is delegated to the user. The scaffolded playwright config has a commented-out dotenv-loading line — uncomment to load `forge/.env` on each spec run, or leave it commented and use direnv / dotenv-cli / shell exports.

## Invocation

Run the scaffold script with the target directory. Empty args defaults to PWD:

```bash
node <PLUGIN_ROOT>/scripts/forge-init.mjs "$ARGUMENTS"
```

Where `$ARGUMENTS` is the route-stripped remainder (possibly empty).

## Idempotency

The script preserves existing files (`.gitignore`, `README.md`, hints README, playwright config, `.env`). Re-running is safe — only fills in what's missing.

## After the scaffold — offer to draft `forge.md`

The empty `forge.md` stub is the highest-friction step of adoption, and forge can draft it itself. After relaying the script output, when **both** hold:

- `forge/hints/forge.md` is still an empty stub (the scaffolded one-line comment — check with `cat`), and
- the target directory looks like a codebase (source files present, not a bare sandbox),

offer via `AskUserQuestion`: *"Draft `forge/hints/forge.md` now by reading the codebase?"* — Yes (Recommended) / No ("I'll write it myself — `forge/hints/README.md` has guidance").

On **yes**: follow the checklist in the scaffolded `<target>/forge/hints/README.md` under "Starter prompt" — it's the authoritative spec for what a drafted `forge.md` covers (app shape, routes, canonical selectors per element class, gotchas, env-contract key names, accounts, optional setup/teardown). Read the codebase (`Glob`/`Grep`/`Read`), draft in plain language, `Write` it to `forge/hints/forge.md`, then summarize what it covers and — honestly — what it couldn't determine (note gaps rather than guessing, per the checklist). Remind the user the file is theirs to correct; hints also accrete from real drives.

On **no** (or when the conditions don't hold): finish with the script's "Next:" guidance as-is.

## Hard rules

- **Invoke the script; don't write files yourself** (the one exception: `forge.md`, when the user accepts the drafting offer above). The script is the source of truth for scaffold contents and ensures idempotency.
- **Surface the script's output verbatim.** It reports what it created and preserved.
- **Hint content is the user's call.** The drafting offer is optional and its output is a starting point — the user corrects and extends it; `curator.md` stays untouched unless they ask.
- **Never overwrite a non-empty hint file.** The drafting offer applies only to the empty scaffold stub.

## Output expected

The script prints something like:

```
forge-init: scaffolded /path/to/project/forge
  Created:
    + forge/.gitignore
    + forge/README.md
    + forge/hints/README.md
    + forge/hints/forge.md
    + forge/hints/curator.md
    + forge/playwright.config.ts

Next: fill in the empty hint stubs in /path/to/project/forge/hints/ to describe your
project — forge.md (env, accounts, app structure, selectors, gotchas) and,
rarely, curator.md (snippet conventions). Both are optional; empty = defaults.
See /path/to/project/forge/hints/README.md for guidance.
```

Relay that verbatim to the user.
