# Changelog

A high-level history of forge — the notable, user-facing shifts rather than
every version bump. The full granular history is in the git log. Forge is young
and pre-1.0 (built over June 2026), so a minor version can still carry a
meaningful architecture change.

## 0.42.0 — Deterministic filtered perception (`forge-observe`) (2026-07-05)

- New `forge-observe` script — a pure, model-free transform that turns a
  playwright-cli ARIA snapshot into the interactable, labelled surface the driver
  actually acts on: elements with their `[ref]` handles, plus error/alert signals
  (with their message text folded in), and a change-diff (`+`/`~`/`-`) since the
  last look. Long option lists collapse to one summary line, a URL change
  re-baselines to the full view, and unactionable/unlabelled nodes are dropped.
- The driver now **orients through `forge-observe` by default** rather than
  re-reading raw snapshots each turn — cutting per-turn perception context
  ~6–10× on real multi-step flows, which lowers cost, speeds prefill, and (with
  less noise) steadies element grounding. Raw `snapshot`/`--depth` and an
  aggressive `--diff` remain as documented escalations. Perception only: it never
  enters the trace, so composed specs are unaffected.

## 0.41.0 — Hint proposals become a gentle nudge (2026-06-28)

- Removed the formal end-of-run hint-proposal protocol (`protocols/proposals.md`,
  the structured `PROPOSALS` message, the lead's lint, and the per-item
  accept/reject review). A mandatory "emit proposals" slot manufactured noise —
  pulling agents toward marginal, snippet-adjacent suggestions even when the
  honest answer was nothing — and its review blocked teardown.
- In its place: the driver may append a single optional `Hint worth adding: …`
  line to its completion ping, and the lead surfaces it in the wrap-up summary as
  a gentle, non-blocking offer to add a line to `forge.md`. A clean run says
  nothing. App knowledge only — snippet fixes stay the curator's (via patches),
  and `/forge clean` remains the deliberate library-curation sweep.

## 0.40.0 — Operate vs curate hints (2026-06-28)

- Hint files collapse onto a single boundary: **`forge.md`** (operate the app —
  env, accounts, setup/teardown, app structure, routes, selectors, gotchas,
  spec deviations; read by the lead **and** driver) and **`curator.md`** (snippet
  conventions; read by the curator). The old `driver.md` / `spec.md` hint files
  are gone, merged into `forge.md`.
- A documented gotcha in `forge.md` is now the cheapest first tier of check-in
  routing — the lead resolves a driver block from the hint before reading
  source or interrupting the user.
- Agents honor in-hint pointers ("the selectors live in `selectors.md`"), so the
  strict per-file defaults stay overridable per project.
- `/forge init` scaffolds `forge.md` + `curator.md` as empty stubs, so the names
  forge loads are pre-created and can't be misnamed. Empty = defaults.

## 0.39.0 — Agents renamed (2026-06-28)

- `driver-worker` → **`driver`**, `snippet-curator` → **`curator`**. Dropped the
  vestigial qualifiers; the agent names read cleanly and the hint files align.

## 0.33.0–0.38.0 — Concurrent curation, validated (2026-06-27)

- `forge-read-trace` gives the curator a reliable window into the driver's
  verbatim action-stream.
- The curator is signal-driven: it authors opportunistically on each drive-chunk
  and drains at drive-complete, so snippets land **during** the drive and survive
  an interrupted run — rather than batching at the end.
- Browser close runs first at teardown, independent of the shutdown handshake.
- `/forge run` defaults to headed (the watch-it / evidence path).
- README architecture refreshed to the validated two-agent design.

## 0.24.0–0.32.0 — Coordination as shared protocols (2026-06-26 → 27)

- Teammate coordination extracted into shared contract files: `escalation.md`
  (the single upward **check-in** — the driver surfaces friction, the lead
  routes it), `proposals.md` (end-of-run hint proposals), `signals.md` (the
  coordination vocabulary).
- Teach mode dissolved into a **collaborativeness** dial — named levels
  (`autonomous` → `light-touch` → `guided` → `step-by-step`) governing how
  readily the lead brings the user in. `/forge teach` is the top of that dial,
  not a separate set of agents.
- Escalation routing moved entirely to the lead: one upward check-in, and the
  lead decides answer-from-code / steer / ask-user / wave-on.
- Hint taxonomy and the folder tree (`protocols/` vs `routes/`) tracked to the
  two-agent topology.

## 0.21.0–0.23.0 — The two-mind redesign (2026-06-26)

- Collapsed the original four-agent team (driver + snippet-author + spec-writer
  + verifier) to a single worker that drives, composes the spec from its own
  verbatim trace, and self-verifies — fixing spec fidelity by freezing from the
  trace instead of relaying through lossy prose handoffs.
- Then split out a **concurrent** snippet curator: the driver drives and specs;
  the curator watches the driver's trace and owns the snippet library in real
  time.
- The lead became the durable backstop — an investigation tier that reads source
  read-only to answer, closes the browser unconditionally, and owns user
  escalation.

## 0.18.0–0.19.9 — Maintenance, hygiene, project-agnostic (2026-06-15 → 25)

- `/forge clean` maintenance route; structured snippet `meta` + an
  auto-generated `INDEX.md`; lint for snippet/hint accumulation.
- Token-footprint reduction; self-claim task model.
- `--slow-mo` retry lever for timing-fragile specs (async-state-machine UI
  libraries where atomic operations race the framework's lifecycle).
- Native-first authoring; cross-agent hint isolation.
- A full sweep to keep the plugin project-agnostic — examples drawn only from
  the public sample sites or generic stand-ins.

## 0.15.0–0.17.1 — Standalone + project-delegated env (2026-06)

- Standalone repo; cross-platform scripts; the Playwright runner installs
  project-locally under `forge/`.
- Dropped the session pool; credentials and env handling became a project
  concern, deferred to the shell (direnv / dotenv / exports) and declared by
  key name in hints.

## Initial development — the pipeline (2026-06)

- The `forge/` project convention and the `/forge init` scaffold.
- The agent-team architecture on Claude Code's experimental teams: drive a real
  browser, accrete reusable snippets, compose a self-contained Playwright spec,
  verify it from a cold start, and export it for shipping.
- A `STUCK` escalation channel (the team can ask the human); video recording and
  `/forge run` for paired before/after evidence.
- Three exemplar samples — auth + multi-account, interaction-probe, and
  legacy-widget — with prompt-by-prompt walkthroughs against public test sites.
