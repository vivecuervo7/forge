# /forge — init reference

Loaded by `/forge`'s router for the **init** route. The router stripped the `init` keyword; the remaining text (possibly empty) is an optional target directory.

**Placeholder note.** `<PLUGIN_ROOT>` in the bash commands below — substitute the literal path captured in SKILL.md phase 1.0. Do **not** use `${CLAUDE_PLUGIN_ROOT}` here: the env var isn't reliably populated in this bash context.

## What this route does

Scaffolds the canonical `forge/` layout into a project. Run once at the start of using forge against a new project; sets up the directory and writes hint-authoring guidance.

## What gets created

```
<target-dir>/
└── forge/
    ├── .gitignore          # committed: self-documenting policy
    ├── README.md           # committed: points at the conventions doc
    ├── playwright.config.ts # committed: fallback Playwright config
    └── hints/              # committed dir; only forge artifact in version control
        └── README.md       # gitignored: local guidance for authoring hints
```

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
- **Hint authoring is the user's job.** The script creates the scaffold; authoring `forge.md`, `driver.md`, etc. is the user's responsibility (with optional help in subsequent invocations).

## Output expected

The script prints something like:

```
forge-init: scaffolded /path/to/project/forge
  Created:
    + forge/.gitignore
    + forge/README.md
    + forge/playwright.config.ts
    + forge/hints/README.md

Next: author hint files in /path/to/project/forge/hints/ to describe your project's
env contract, provisioning recipe, and any project-specific conventions.
See /path/to/project/forge/hints/README.md for guidance.
```

Relay that verbatim to the user.
