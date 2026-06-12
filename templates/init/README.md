# forge/

This directory holds forge artifacts for this project.

Only `hints/` is committed. Everything else (snippets, specs, videos, pool
state, transcripts) is local to your machine — see `.gitignore` for the
policy.

Hints are project-specific knowledge that every contributor needs: env
contract, provisioning recipes, app structure, conventions. See
`hints/README.md` (your local copy, gitignored) for guidance on authoring
them, or the full convention doc in the forge plugin source at
`plugins/forge/docs/project-conventions.md`.

## Quick reference

| File                      | Consumer                       | Typical content                                  |
|---------------------------|--------------------------------|--------------------------------------------------|
| `hints/forge.md`          | `/forge` skill                 | env contract, provisioning recipe, setup, teardown |
| `hints/driver.md`         | `forge:driver` agent           | app structure, routes, personas, gotchas         |
| `hints/snippet-author.md` | `forge:snippet-author` agent   | snippet conventions for this project             |
| `hints/spec-writer.md`    | `forge:spec-writer` agent      | spec conventions, naming, required imports       |
| `hints/spec-verifier.md`  | `forge:spec-verifier` agent    | how to verify specs, reset patterns              |

Minimum-viable hint files are very small. Forge has sensible defaults for
everything; hints encode only project-specific deviations.
