# forge/

This directory holds forge artifacts for this project.

Only `hints/` is committed. Everything else (snippets, specs, videos,
transcripts, test results) is local to your machine — see `.gitignore`
for the policy.

Hints are project-specific knowledge that every contributor needs: env
contract, provisioning recipes, app structure, conventions. See
`hints/README.md` (your local copy, gitignored) for guidance on authoring
them.

## Quick reference

| File                      | Consumer                       | Typical content                                  |
|---------------------------|--------------------------------|--------------------------------------------------|
| `hints/forge.md`          | `/forge` skill (the lead)      | env contract, provisioning recipe, setup, teardown |
| `hints/driver.md`         | `driver-worker`                | app structure, routes, personas, gotchas         |
| `hints/spec.md`           | `driver-worker` (spec mode)    | spec conventions, naming, verification, reset patterns |
| `hints/snippet-author.md` | `snippet-curator`              | snippet conventions for this project             |

Minimum-viable hint files are very small. Forge has sensible defaults for
everything; hints encode only project-specific deviations.
