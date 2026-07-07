# /forge — help reference

Loaded by `/forge`'s router for the **help** route. The router stripped the `help` keyword; the remaining text (possibly empty) is an optional topic ("teach", "recording", "hints", …).

No scripts, no browser, no team — this route only relays a reference. Present the material below in your own voice, tight markdown. A bare `/forge help` gets the whole reference; a targeted question ("how do I teach forge?") gets the relevant slice, not the full dump.

## Commands

| Command | What it does |
|---|---|
| `/forge init` | Scaffold `forge/` into the current project (idempotent). Offers to draft `hints/forge.md` from the codebase. |
| `/forge <task>` | Drive the task in a fresh browser while reusable snippets accrete. The everyday command. |
| `/forge spec <task>` | Drive **and** compose a verified Playwright spec — a regression test, a red-green bug repro, or an assertion-less scenario. |
| `/forge teach <topic>` | Step-by-step collaborative drive: you teach the quirky bits, and they get baked into snippet bodies. |
| `/forge run <spec\|last>` | Re-run a verified spec. Add `record as <label>` to capture video evidence (e.g. paired `before`/`after` around a fix). |
| `/forge export <name>` | Inline a spec's snippets so it ships anywhere `@playwright/test` is installed. |
| `/forge clean [snippets\|hints]` | Scan the library and hint files for cruft. Nothing is applied without approval. |
| `/forge help [topic]` | This reference. |

Most commands also fire on natural phrasing — "teach forge how to log in", "create a spec for PROJ-123", "tidy up the snippet library".

## Mid-run controls (just type — the lead relays)

- **Steer the drive** with any instruction: "skip the promo modal", "log in as admin instead".
- **"walk me through this next bit"** → forge goes step-by-step with you; **"take it from here"** → autonomous again.
- **"I'll take the wheel"** → you drive the browser yourself; when you hand back, tell forge where you ended up.
- **Steer the library**: "save that as `login-with-sso`", "split that snippet", "make `item` an arg".
- **"stop"** → abort the run; the browser always gets closed.

## Watching a drive

Drives run headless by default — watch live in the Playwright dashboard (forge opens it for you). For a visible browser window instead: say "watch" / "headed" in the task, export `FORGE_HEADED=1`, or put a headed-preference line in `forge/hints/forge.md`. Teach mode is always headed.

## Where things live

- `forge/hints/forge.md` — project knowledge: env key names, accounts, selectors, gotchas. The only tracked content, and the highest-leverage file (`/forge init` offers to draft it).
- `forge/snippets/`, `forge/specs/`, `forge/videos/` — accreted locally as you drive; gitignored.
- Worked end-to-end examples: the plugin's `samples/` directory (shop / internet / widgets), each with a prompt-by-prompt walkthrough.

## Hard rules

- **Relay only.** No scripts, no browser session, no teammates from this route.
- **Answer the question asked.** A targeted topic gets its slice; only a bare `/forge help` gets the full reference.
