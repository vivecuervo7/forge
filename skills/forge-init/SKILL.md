---
name: forge-init
description: "Scaffolds the forge/ directory convention into the current directory. Idempotent — re-running fills in missing pieces without overwriting customizations. Use when starting forge work on a new project. Triggers on '/forge-init' slash invocation."
model: haiku
effort: low
argument-hint: "[target-directory]"
allowed-tools: Bash(bash **/forge/*/scripts/forge-init.sh*)
---

# forge-init

Scaffolds the canonical `forge/` directory layout into a project. Run this once at the start of using forge against any new project; it sets up the directory structure described in `plugins/forge/docs/project-conventions.md`.

## What gets created

```
<target-dir>/
└── forge/
    ├── .gitignore          # committed: self-documenting policy
    ├── README.md           # committed: points at the conventions doc
    └── hints/              # committed dir; only forge artifact in version control
        └── README.md       # gitignored: local guidance for authoring hints
```

Everything else under `forge/` (snippets, specs, videos, the pool, transcripts) is created lazily by other forge skills as they write into it. After scaffolding, the only thing the user has to do is **author hint files** in `forge/hints/` describing their project's specifics.

## Invocation

Run the scaffold script with the target directory (defaults to current working directory):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/forge-init.sh "$ARGUMENTS"
```

Pass `"$ARGUMENTS"` so the user can optionally point at a different directory. The script handles the empty-arg case by defaulting to PWD.

## Idempotency

The script preserves existing files. If `forge/.gitignore` already exists, it's left alone (the user may have customized it). Same for `README.md` and the hints README. Re-running `/forge-init` after authoring custom hints is safe — it'll only fill in anything missing.

## Hard rules

- **Don't write files yourself** — invoke the script. It's the source of truth for the scaffold contents and ensures idempotency.
- **Surface the script's output verbatim.** It reports what it created and what it preserved; that's the information the user wants.
- **Don't author hint files.** The script intentionally only creates the scaffold; authoring hints is the user's job (with optional help from forge in subsequent invocations).

## Output expected

The script prints something like:

```
forge-init: scaffolded /path/to/project/forge
  Created:
    + forge/.gitignore
    + forge/README.md
    + forge/hints/README.md

Next: author hint files in /path/to/project/forge/hints/ to describe your project's
env contract, provisioning recipe, and any project-specific conventions.
See /path/to/project/forge/hints/README.md for guidance.
```

Relay that verbatim to the user.
