# Changelog

A high-level history of forge — the notable, user-facing shifts rather than
every version bump. The full granular history is in the git log. Forge is young
and pre-1.0 (built over June 2026), so a minor version can still carry a
meaningful architecture change.

## 0.46.0 — `observe --live`: one-call perception (2026-07-08)

- `forge-cli.mjs observe --live -s=<session>` takes the snapshot itself
  (through forge-pw, so redaction still applies) and prints the filtered view
  in one call — replacing the driver's snapshot-to-file → observe two-step in
  its hottest loop (recent runs average 20–33 observes per drive).
- The page URL is read from the snapshot echo, so navigation detection is
  self-contained — the driver no longer tracks or passes `--url` at all.
  Snapshots land in the project's `forge/.observe/<session>.yaml` as before
  (OS tmpdir when no forge root is findable).
- The file/stdin forms and `--diff`/`--full` escalations are unchanged;
  driver.md's fresh-drive recipe is now two lines (observe, act).

## 0.45.0 — One front door: the `forge-cli` entry point (2026-07-08)

- All forge scripts are now reached through a single dispatcher:
  `node <plugin>/scripts/forge-cli.mjs <verb> [args...]` — e.g. `forge-cli.mjs
  pw -s=demo open`, `forge-cli.mjs observe <snapshot>`, `forge-cli.mjs
  snippet-index <root>`. Bare `forge-cli.mjs` lists every verb with its
  one-line description (read from each script's own header).
- The dispatch is an in-process argv rewrite + dynamic import — no extra
  process, and every `forge-<verb>.mjs` script keeps working standalone.
  Agent prompts, route references, the guard hook's deny message, and the
  generated INDEX header all point at the front door now.
- Why: callers reference one path and a verb, so verbs can migrate from
  standalone scripts to shared modules without any caller changing — this is
  the seam for the eventual extracted `forge-cli`, landed as a pure refactor
  with zero behavior change. First brick of the verb-unification /
  preflight / observe-chaining roadmap.

## 0.44.0 — Ergonomics: the run banner, `/forge help`, and next-step affordances (2026-07-07)

- **The run banner.** The lead now announces every run as it goes live: what's
  driving, the session name to spot in the dashboard, and — the part that was
  invisible before — that you can steer by just typing, and abort with "stop".
  Teach/guided runs extend the banner with the teaching vocabulary ("take it
  from here", "I'll take the wheel", "save that as `login-with-sso`") so the
  controls are discoverable up front rather than buried in docs.
- **`/forge help [topic]`** — a new route: compact reference for the commands,
  mid-run steering phrases, watching options, and where things live. A targeted
  question ("how do I record a video?") gets its slice, not the full dump.
- **Reports hand you the next gesture.** Spec-mode reports end with a `Next:`
  line matched to the verdict (verified → `/forge run` / `export`; repro
  confirmed → `record as after` once the fix lands; repro green → offer to
  promote the claim). `/forge run` failures offer the exact re-author command by
  reading the original task out of the spec's header comment.
- **`/forge init` offers to draft `forge.md`.** The empty hint stub was the
  highest-friction step of adoption; init now offers to read the codebase and
  draft the operate hint (selectors, routes, gotchas, env-key names) following
  the hints-README starter checklist. Optional; never overwrites a non-empty file.
- **Setup friction absorbed:** when the agent-teams flag is missing, forge
  offers to add it to `~/.claude/settings.json` itself (restart still required).
  A headed preference can now live as a line in `forge.md` instead of requiring
  the `FORGE_HEADED` env var at launch. Spec-intent and repro-bug-claim
  questions ask in one round instead of two.

## 0.43.0 — Headless by default, watchable in the dashboard (2026-07-07)

- Drives now run **headless by default**. Instead of a browser window popping up
  and stealing focus (or trapping keystrokes in its address bar), you watch the
  live session in the **Playwright dashboard** (`playwright-cli show`) — one
  non-intrusive pane that renders every running session, its views input-locked.
  The lead opens the dashboard for you on a headless run.
- **The lead now owns the browser lifecycle** — it opens the session (then the
  dashboard) before spawning the driver, and closes it at the end. Ordered
  open → dashboard → drive → close, so the driver arrives to a ready session
  rather than racing to open one.
- **Headed is still one word away** for when you want to step in: teach mode, an
  explicit "watch" / "let me take the wheel", or `FORGE_HEADED=1`.
- **Session names are short and meaningful** (a ticket key, or a terse task gist)
  so you can match a session to its work at a glance in the dashboard — capped to
  stay within the OS's socket-path limit.

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
