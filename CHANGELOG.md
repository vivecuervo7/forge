# Changelog

A high-level history of forge — the notable, user-facing shifts rather than
every version bump. The full granular history is in the git log. Forge is young
and pre-1.0 (built over June 2026), so a minor version can still carry a
meaningful architecture change.

## 0.54.0 — Spec runs in the dashboard (2026-07-08)

- **`run-spec --dashboard`** — the headless spec run renders live in the
  Playwright dashboard, alongside forge's drives. Mechanism: the run's
  browser exposes a CDP port (`FORGE_SPEC_CDP`, honored by the scaffolded
  config; projects with their own config opt in the same way as
  `FORGE_RECORD`/`FORGE_SLOW_MO`), and run-spec attaches a playwright-cli
  session (`spec-<name>`) to it for the run's duration, detaching at the
  end. Best-effort at every step — the run never fails because the viewing
  rig didn't come up.
- **The last window-popping surface is gone**: cold-verify (driver) and
  `/forge run` now use `--dashboard` instead of `--headed` — every browser
  forge opens lives in the one dashboard window. `--headed` remains the
  explicit escape hatch; `--slow-mo` paces a fast replay for watching.

## 0.53.0 — Concurrency tune-up: timely signals, patient reads (2026-07-08)

- Live curation had drifted back toward author-everything-at-the-end, from
  both directions: drivers deferred chunk signals under focus pressure, and
  the curator's per-chunk reads took only what was *already flushed* — a
  signal announcing a not-yet-flushed chunk yielded nothing, the curator
  idled, and the next wake was often `drive complete`.
- **Driver:** the chunk signal is now part of finishing the chunk — fired the
  moment its last action lands, before the next chunk begins.
- **Curator:** each signal now triggers one **bounded** read (`--await 10`,
  one follow-up at most) — the signal is proof a chunk just landed, so a
  short wait for its flush is justified and returns as soon as the actions
  appear. Still strictly signal-driven and idle-first (the 0.35 rule that
  fixed the starved-signals pathology): one signal, one bounded read, never
  an open polling loop.

## 0.52.0 — One way in: the verbs become modules (2026-07-08)

- The consolidation 0.45.0 deferred: per-verb scripts are now **pure modules**
  under `scripts/lib/` — each exports `main(args)`, none executes on import,
  and running one directly is a no-op. `forge-cli.mjs` is the **only**
  runnable surface; it imports the verb's module and calls `main()` (no more
  argv-rewrite trick).
- **Internal cross-calls go through the front door too**: `observe --live` →
  `pw`, preflight → `pw`/`dashboard`, init → `snippet-index`/`ensure-runner`,
  cleanup-scan → `snippet-index`. One invocation grammar everywhere — what a
  human types, what an agent runs, and what a transcript records are the same
  shape.
- **The legacy grammar is gone**: `read-trace` parses only front-door
  commands. A mixed-version team (stale agent definition driving old-form
  commands) now reads as zero actions — by choice: that state is already
  detected and warned about by preflight's dual-install check, and the
  curator's transcript fallback keeps it soft. Clean world over
  compatibility tail.
- The dispatch test matrix now pins the locked side doors (direct lib
  invocation: exit 0, zero output); every internal chain smoke-verified
  (init/scaffold, cleanup-scan, preflight browser open, `observe --live`,
  `invoke-snippet` round trip, run-spec watchdog exit 7).

## 0.51.0 — Version-coherent teams (shakedown hardening) (2026-07-08)

- **The lead's resolved plugin root now threads through the whole team.**
  Teammate agent definitions resolve to *some* installed forge copy — when a
  dev `--plugin-dir` checkout coexists with a marketplace install, a run
  could silently mix versions (observed: dev lead, marketplace driver).
  Spawn prompts now carry `PLUGIN_ROOT`, and the driver/curator run every
  forge script from it (falling back to their own `${CLAUDE_PLUGIN_ROOT}`
  only when unthreaded), so scripts, protocols, and routes stay one version
  regardless of which copy's agent definition loaded.
- **Preflight detects coexisting installs** (`otherForgeInstalls`, cache
  families collapsed to newest) and the run banner warns to disable one copy;
  it also reports `insideTmux` + `teammateMode` so the banner states where
  teammates render (panes vs inline) instead of the mode differing silently.
- **Sequential runs in one session no longer break trace reads**: teammate
  names must be unique per session (`driver-2`), and the curator's
  `read-trace` now threads `--driver <DRIVER_NAME>` so the locate matches the
  actual teammate, not the literal `driver`.
- **Primitives are discoverable**: the INDEX now carries one line per
  `_`-prefixed primitive (description read from its header) alongside the
  snippet listing, and `/forge init` generates the initial INDEX — a fresh
  scaffold starts with "0 snippets + the `_wait-until-stable` primitive"
  instead of no INDEX at all (which previously left the primitive findable
  only via a clause in the driver's own prompt).

## 0.50.0 — Settle patterns + the `_wait-until-stable` primitive (2026-07-08)

- **`/forge init` scaffolds `snippets/_wait-until-stable.ts`** — a shared
  settle primitive: poll a read until N consecutive identical results within
  a deadline (one stable read is a false plateau; the streak is the fix).
  Snippets and specs `import` and compose it.
- **The underscore convention is now formal**: `_`-prefixed files in
  `snippets/` are shared primitives — no `meta`, excluded from the INDEX and
  from `/forge clean`'s snippet scan (previously an existing helper was
  flagged as a broken snippet), imported rather than invoked.
- **driver.md names the settle-pattern categories** with their standard first
  moves: deferred mutation → fence + poll-until-stable + resubmit guard; rich
  custom widgets (Kendo/DevExpress/Telerik) → `.fill()` + blur; overlay
  intercepts (ripples/tooltips/toasts) → ARIA-state check, `exact: true`,
  `dispatchEvent`; toolbox-to-canvas drag → manual mouse sequence. Which
  framework and which selector stays project knowledge in `forge.md`; the
  moves are universal — this is what recent runs re-derived from scratch
  three times in a single session.
- **curator.md sanctions the one refactor**: a hand-rolled settle loop in the
  trace gets baked as a `waitUntilStable(...)` composition (same reads, same
  thresholds); new primitives only when a mechanism recurs across snippets.

## 0.49.0 — Trace reads pinned to the run (2026-07-08)

- **`read-trace --started-after <time>`** — two sequential drives under one
  parent session share a `teamName`, so driver-identity matching alone could
  land the curator on the *earlier* drive's transcript (observed: ~9 tool
  calls parsing the wrong driver's actions). Preflight now stamps
  `startedAt`, the lead threads it into the curator's spawn prompt as
  `RUN_STARTED_AT`, and the curator's trace reads exclude any transcript
  finished before the run began.
- When multiple transcripts still match, the newest is used and a `# WARNING`
  names the others (the curator surfaces ambiguity in its completion ping);
  when the expected project dir has no match (a driver running under a
  different cwd), other project dirs are scanned as a bounded fallback —
  recently-written files only — with a `# note` naming what was found where.
- New disambiguation test matrix (`forge-read-trace.test.mjs`). Worst case on
  a miss stays inefficiency, never breakage — the trace is only the curator's
  accretion source.

## 0.48.0 — Hardening from the 2026-07-07 session review (2026-07-08)

- **`run-spec` inactivity watchdog (exit 7).** The observed failure mode was a
  runner hanging silently for 10+ minutes — sometimes without ever launching a
  browser — leaving the driver blocked and Chrome processes orphaned.
  `forge-run-spec` now kills the runner after `FORGE_SPEC_STALL_SECS` (default
  480; `0` disables) of **total silence** and exits 7 with a diagnostic. This
  is deliberately an inactivity detector, not a wall-clock cap: the timer
  resets on every output byte, so long overnight sessions and slow healthy
  runs are untouched. The driver treats exit 7 as "wedged run, not a verdict":
  re-run once, then check in.
- **`/forge clean` detectors recalibrated.** `low-value-tags` now catches
  empty/missing tags (previously only the literal `['auto-authored']` — a
  111-snippet library scanned clean while 38 snippets had no tags);
  `byBody` overlap requires 3 shared lines that *do* something (the shared
  run()-skeleton no longer clusters the whole library); `orphan-reference`
  requires corroboration (a snippet-verb first word, or surrounding text
  about snippets) so CSS classes and library attributes stop flagging. The
  index refresh's hygiene warnings now surface as `indexWarnings` in the scan
  JSON and in the clean report instead of being swallowed.
- **Guard-hook regression cases** for the mention-vs-invocation fix
  (`0bd77b3`): reading `.playwright-cli/*.log` files with `tail`/`grep`/
  `wc`/`find`/`python3` is a mention and stays allowed (43-case matrix).

## 0.47.0 — `preflight`: the lead's setup as one command (2026-07-08)

- New `forge-cli.mjs preflight --session <name> [--headed]` — everything
  deterministic the lead did across Phase 1, in one call: locate the forge
  root, open the browser session, open the dashboard when headless
  (idempotent), compute the cleanup-staleness nudge, validate the session
  name against the socket-path cap, and print the forge.md hints plus the
  escalation/collaborativeness protocols the lead needs in context. A JSON
  summary leads the output (forgeRoot, headed + its source, browser/dashboard
  state, setup/teardown-section flags, cleanup nudge).
- Judgment stays with the lead: it names the session and decides
  headed-vs-headless from the run's framing before calling; preflight adds
  only the deterministic `FORGE_HEADED` env check. Project-specific setup
  (`## Setup before each run`) remains hint-file prose the lead follows —
  nothing project-shaped moved into plugin code.
- `team-task.md` Phase 1 shrinks from seven prose-driven steps to
  decide-then-one-command; the run reaches its spawn phase several tool
  calls sooner.
- The lead now inherits the session's model — SKILL.md no longer pins
  `model: sonnet`. The lead is the escalation/routing tier; it should run on
  whatever the user's session runs on.

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
