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

Two hint files, one boundary — **operating the app** vs **curating the library**:

| File               | Read by         | Typical content                                  |
|--------------------|-----------------|--------------------------------------------------|
| `hints/forge.md`   | lead + driver   | the operate contract — env, accounts, setup/teardown, app structure, routes, selectors, gotchas, spec deviations |
| `hints/curator.md` | curator         | snippet-authoring conventions (usually empty)    |

Both are scaffolded empty; fill in only what your project needs. Forge has
sensible defaults for everything — hints encode only project-specific
deviations. A project can opt an agent into another file with an in-hint
pointer ("the selectors live in `selectors.md`") and the agent will follow it.
