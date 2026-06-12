# /forge — init reference

This reference is loaded by `/forge`'s router for the **init** route. The router has stripped the `init` keyword from the args; the remaining text (possibly empty) is an optional target directory.

## What this route does

Scaffolds the canonical `forge/` directory layout into a project. Run this once at the start of using forge against any new project; it sets up the directory structure described in `plugins/forge/docs/project-conventions.md`.

## What gets created

```
<target-dir>/
└── forge/
    ├── .gitignore          # committed: self-documenting policy
    ├── README.md           # committed: points at the conventions doc
    ├── playwright.config.ts # committed: fallback Playwright config
    ├── .env                # gitignored: forge-specific env baseline
    └── hints/              # committed dir; only forge artifact in version control
        └── README.md       # gitignored: local guidance for authoring hints
```

Everything else under `forge/` (snippets, specs, videos, the pool, transcripts) is created lazily by other routes as they write into it. After scaffolding, the user authors hint files in `forge/hints/` describing their project's specifics.

## Invocation

Run the scaffold script with the target directory. Empty args defaults to PWD:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-init.sh "$ARGUMENTS"
```

Where `$ARGUMENTS` is the route-stripped remainder (possibly empty).

## Idempotency

The script preserves existing files. If `forge/.gitignore` already exists, it's left alone (the user may have customized it). Same for `README.md`, the hints README, the playwright config, and `.env`. Re-running after authoring custom hints is safe — it'll only fill in anything missing.

## Hard rules

- **Invoke the script, don't write files yourself.** It's the source of truth for the scaffold contents and ensures idempotency.
- **Surface the script's output verbatim.** It reports what it created and what it preserved; that's the information the user wants.
- **Hint authoring is the user's job.** The script creates the scaffold; authoring `forge.md`, `driver.md`, etc. is the user's responsibility (with optional help from forge in subsequent invocations).

## Output expected

The script prints something like:

```
forge-init: scaffolded /path/to/project/forge
  Created:
    + forge/.gitignore
    + forge/README.md
    + forge/playwright.config.ts
    + forge/.env
    + forge/hints/README.md

Next: author hint files in /path/to/project/forge/hints/ to describe your project's
env contract, provisioning recipe, and any project-specific conventions.
See /path/to/project/forge/hints/README.md for guidance.
```

Relay that verbatim to the user.
