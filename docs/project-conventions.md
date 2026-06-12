# Forge project conventions

How a project structures its forge-related artifacts. Applies to any project that uses forge — sandbox, real apps, single-repo, wrapper-style. The plugin's own working directory will eventually adopt the same shape (after `/forge` absorbs `/forge`).

## The shape

```
<project-root>/
└── forge/
    ├── .gitignore        # self-documenting: gitignore-everything-except-hints
    ├── README.md         # what this directory is, links here
    ├── hints/            # COMMITTED: project hint files
    │   ├── README.md     # local-only, gitignored — author guidance
    │   ├── forge.md      # consumed by the /forge skill
    │   ├── driver.md     # consumed by forge:driver
    │   ├── author.md     # consumed by forge:snippet-author
    │   ├── spec-writer.md  # consumed by forge:spec-writer
    │   └── verifier.md   # consumed by forge:spec-verifier
    ├── snippets/         # local: working snippets (auto-authored + curated)
    ├── specs/            # local: spec-writer output, copy wherever you want when ready
    ├── videos/           # local: screen recordings
    ├── .pool/            # local: pool slots (created lazily when first run claims)
    └── .transcripts/     # local: session jsonl, gitignored, debug-only
```

The project-root `.gitignore` says **nothing** about forge. The `forge/.gitignore` handles it internally.

## The single committed thing: `forge/hints/`

`hints/` is the only directory that ever enters version control. Hint files describe project-specific knowledge that every contributor needs — env contract, provisioning recipes, app structure, snippet conventions, spec discipline. They're the contract that lets forge work consistently across machines.

Everything else under `forge/` is **local working state** by default. Snippets, scratch outputs, specs pending review, videos, the pool, transcripts — all gitignored. A teammate cloning the repo sees only `forge/hints/`. They run `/forge ...` and the system builds up the local working state on their machine from scratch, driven by what's in the hints.

## The self-documenting `forge/.gitignore`

```
# By default, everything in this directory is local to your machine.
# Snippets, specs pending review, videos, pool state, transcripts — these
# are working artifacts you build up as you use forge, not things every
# teammate needs in the repo.
#
# Hints are the exception: they describe project-specific knowledge that
# every contributor needs (env contract, provisioning recipes, etc.).
#
# If your project has additional artifacts that should be shared (e.g.
# specific snippets you've curated and want everyone to use), add a
# `!path/` line below.

*
!.gitignore
!README.md
!hints/
!hints/**

# The hints/ README.md is scaffold-only — local guidance for authoring hints,
# not project-specific knowledge. Each user gets a fresh copy from /forge-init.
hints/README.md
```

This file is itself committed (it un-excludes itself in the first `!` line) and acts as the policy declaration. Reading it tells you:
- The default policy ("forge stuff is local")
- The exception ("hints are shared")
- How to extend it ("add a `!path/` line")
- The README quirk ("hints/README.md is local scaffold")

## Hint files: one per consumer, not per topic

Each hint file is named after the **consumer** that reads it, not the **topic** it covers. This keeps the contract obvious and bounded — when forge spawns the spec-writer agent, the agent knows exactly which file holds its instructions.

| File | Consumer | Typical content |
|---|---|---|
| `forge.md` | the /forge skill | env contract, provisioning recipe, env-loading approach, pool location override (if needed) |
| `driver.md` | forge:driver | app structure, common routes, available test users / personas, known gotchas |
| `snippet-author.md` | forge:snippet-author | snippet conventions for this project, naming patterns, what to extract vs not |
| `spec-writer.md` | forge:spec-writer | spec conventions, output location, naming convention, required imports |
| `spec-verifier.md` | forge:spec-verifier | how to verify specs for this project, project-specific reset patterns |

The skill includes excerpts of `forge.md` when it spawns each agent, so shared knowledge propagates without the user having to cross-reference between files. The user authors once; the skill handles distribution.

## Env loading: declared in `forge.md`, interpreted by the skill

The hint declares how this project's env gets loaded onto a slot's subprocess. Examples:

For a direnv-using project:

```markdown
## Env loading
This project uses direnv. Each slot has a `.envrc` that exports
the required env keys. When invoking commands that need a slot's env,
wrap with `direnv exec <slot-dir>`.
```

For a plain dotenv project:

```markdown
## Env loading
Each slot has a `.env` file with `KEY=VALUE` lines. Source it
into the subprocess env before invoking commands.
```

For a sops-using project:

```markdown
## Env loading
Each slot has a `.env.enc` file encrypted with sops. Decrypt
to the subprocess env via `sops exec-env <slot>/.env.enc <command>`.
```

The skill reads this and applies the pattern. **No project-authored wrapper script.** No code to maintain per project — just a paragraph of plain text. The skill handles common patterns (direnv, dotenv, sops) natively; if a project needs something exotic, the hint can describe it in enough detail that the skill knows what to do.

## Discipline rules live in agent prompts, not hints

Universal forge defaults — never bake env values into emitted code, snippets must be idempotent, specs must be E2E from login, etc. — live in the agent definition files at `plugins/forge/agents/`. They apply to every project automatically.

Hints encode only **project-specific deviations or additions**. If a project's hint doesn't override anything, the agent applies forge defaults. Minimum-viable hint files can be very small — sometimes just an env contract and a provisioning recipe.

## Pool location

By default, the pool lives at `<project-root>/forge/.pool/`. Project-local; gitignored; deleted when the project is deleted. Each project clone on the same machine gets its own pool.

A project can override by declaring an alternative in `forge.md`:

```markdown
## Pool location
Pool slots live at `~/.local/share/forge-pool/myproject/` (shared across
multiple clones of this repo).
```

The skill respects the declared location. Useful for CI (`/tmp/forge-pool/`), shared dev machines, etc.

## Transcript location

`forge/.transcripts/<run-id>.jsonl`. Gitignored. Debug-only — the system doesn't depend on it. Agents communicate live (via SendMessage) in the agent-team architecture; the transcript is the human's reference for post-mortems.

## Runtime state outside the project

Some forge state is genuinely cross-project user state and lives outside any project's `forge/`:

- The forge plugin itself: wherever Claude Code installs plugins.
- User-global hints (cross-project knowledge): not yet implemented; would live at `~/.config/forge/hints/` if added.

But pool slots, sessions, browser profiles — those are project-scoped and live inside `forge/`. The project owns its working state.

## Wrapper directories (e.g. makerx-ea pattern)

Some projects keep forge artifacts outside the main code repo to avoid polluting it. The makerx-ea pattern uses `~/makerx/ea/.claude/playwright/` as a separate "wrapper" directory. The forge convention is identical inside the wrapper: a `forge/` directory with the same shape. The "project root" is just "wherever the wrapper is."

Single-repo projects put `forge/` directly in the repo. Wrapper-style projects put it in the wrapper. Same convention either way.

## Discovery

The `/forge` skill (and future `/forge`) finds the project's forge root by walking up from the current working directory, looking for a `forge/` directory. First one found wins. Same pattern as git looking for `.git/`, npm looking for `node_modules/`. Run forge from anywhere in the project tree and it locates the right context automatically.

If no `forge/` is found in the tree, the skill surfaces a helpful error: "no forge/ directory found — run `/forge-init` to scaffold one in the current directory."

## Why this shape

- **Maximally simple for the user.** One committed directory (`hints/`). One self-documenting policy file. Five hint files at most.
- **Maximally portable.** No tool-specific dependencies in the convention itself. Direnv users use direnv; dotenv users use dotenv; the convention doesn't care.
- **Maximally additive.** Adding forge to an existing project means running `/forge-init` and authoring hints. No surgery on the project's other directories.
- **Security factoring stays clean.** Hints are committed (and should be safe to commit); secrets live in slot env files which are gitignored. The user can mix plain-literal env files in dev with secret-manager-backed env files in production without forge knowing the difference.
- **Backwards-promotion path is clean.** When a snippet or spec earns its keep, the user copies it wherever they want — there's no enforced destination. Promotion is an explicit human action, not an automated forge step. The forge plugin doesn't dictate where promoted specs live; that's a per-project decision (often informed by the project's existing test infrastructure, if any).

## See also

- `project-forge-session-pool.md` (memory) — design of the pool primitives that consume `forge/.pool/`.
- `project-forge-agent-team.md` (memory) — design of the multi-agent orchestration that consumes the hints.
- `session-pool-plan.md` (in this directory) — phased implementation plan.
