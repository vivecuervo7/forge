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

## Hard rules

- **Invoke the script; don't write files yourself.** It's the source of truth for scaffold contents and ensures idempotency.
- **Surface the script's output verbatim.** It reports what it created and preserved.
- **Hint authoring is the user's job.** The script creates the scaffold; authoring `forge.md` and (rarely) `curator.md` is the user's responsibility (with optional help in subsequent invocations).

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
