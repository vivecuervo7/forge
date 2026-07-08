// Fallback Playwright config for forge specs in this project.
//
// Read by forge-run-spec.mjs when the project has no root-level
// playwright.config.{ts,js,mjs}. If your project has its own runner —
// e.g. e2e-tests/playwright.config.ts with custom fixtures, globalSetup,
// baseURL, etc. — forge-run-spec.mjs will detect and prefer that
// config; this file is then unused and can stay as-is.
//
// ENV LOADING
//
// Forge does NO env handling on its own. Whatever's in `process.env` at
// run time is what your specs and snippets see. You decide how it gets
// there:
//
//   - direnv / shell exports / dotenv-cli — populate your shell env before
//     invoking forge; nothing extra needed here.
//   - dotenv inside this config — uncomment the import + loadEnv calls
//     below. Loads forge/.env (forge-specific overrides) and the project's
//     root .env (baseline) at config-load time. Safe to leave commented
//     out if you don't need it.
//
// // import { config as loadEnv } from 'dotenv'
// // loadEnv({ path: resolve(__dirname, '.env') })
// // loadEnv({ path: resolve(__dirname, '..', '.env') })
//
// Customize this config when you want forge specs to use a config but
// don't want a project-wide one. Common additions:
//   - globalSetup: './global-setup.ts'      // e.g. clear DB before tests
//   - globalTeardown: './global-teardown.ts'
//   - use.baseURL: 'https://your.app/'
//   - reporter: [['list'], ['html']]
//   - timeout: 60_000
//
// Committed to the repo so teammates pick up the same fallback config.
import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

// Playwright's config loader compiles .ts files as CJS, so __dirname and
// process are injected automatically. We declare them to satisfy
// TypeScript without pulling in @types/node as a dep just for this.
declare const __dirname: string
declare const process: { env: Record<string, string | undefined> }

// FORGE_RECORD=1 enables Playwright's video capture for this run. Set by
// `forge-run-spec.mjs --record` (used by `/forge run … record as
// <label>` for paired before/after evidence). If your project has its own
// playwright config, opt in by checking the same env var — that keeps
// recordings behaving consistently regardless of which config is in effect.
//
// Trace is intentionally `retain-on-failure` rather than always-on: traces
// are heavy (HAR + screenshots + action timeline) and the --record use case
// is "video evidence of a passing flow," not "debugger artifact." Failures
// still get a trace so you can diagnose them; passing runs get a clean
// video-only artifact.
//
// FORGE_SLOW_MO=<ms> inserts a fixed pause after every Playwright action,
// via launchOptions.slowMo. Set explicitly by `forge-run-spec.mjs --slow-mo
// <ms>` as a retry lever for async-state-machine UI libraries (Kendo,
// Angular Material with deferred change detection, etc.) where atomic
// Playwright operations race the library's lifecycle. Set a baseline
// directly in the fallback below if your project consistently benefits
// from pacing (e.g. `?? 75`); leave unset for fast specs.
// FORGE_SPEC_CDP=<port> exposes the spec run's browser over CDP so forge can
// attach a playwright-cli session to it — which makes the run render live in
// the Playwright dashboard alongside forge's drives. Set by
// `forge-run-spec.mjs --dashboard`; projects with their own playwright
// config opt in by honoring the same env var.
const record = process.env.FORGE_RECORD === '1'
const slowMo = process.env.FORGE_SLOW_MO ? parseInt(process.env.FORGE_SLOW_MO, 10) : 0
const cdpPort = process.env.FORGE_SPEC_CDP ? parseInt(process.env.FORGE_SPEC_CDP, 10) : 0

export default defineConfig({
  testDir: './specs',
  // Pin output to forge/test-results regardless of cwd so test artifacts
  // never land in the project root (where they wouldn't be gitignored).
  // forge-run-spec.mjs cleans this directory after extracting the
  // video to forge/videos/, so nothing lingers between runs.
  outputDir: resolve(__dirname, 'test-results'),
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    video: record ? 'on' : 'off',
    trace: record ? 'retain-on-failure' : 'off',
    launchOptions: {
      ...(slowMo ? { slowMo } : {}),
      ...(cdpPort ? { args: [`--remote-debugging-port=${cdpPort}`] } : {}),
    },
  },
})
