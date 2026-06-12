// Fallback Playwright config for forge specs in this project.
//
// Read by forge-pool-run-spec.mjs (and by Stage 4's verifier) when the
// project has no root-level playwright.config.{ts,js,mjs}. If your project
// has its own runner — e.g. e2e-tests/playwright.config.ts with custom
// fixtures, globalSetup, baseURL, etc. — forge-pool-run-spec.mjs will
// detect and prefer that config; this file is then unused and can stay
// as-is.
//
// Env loading (highest-precedence wins):
//
//   1. Process env at config-load time — your shell env (direnv if any) +
//      any slot env the wrapper injected via spawn { env } when invoked
//      with --slot <slot>/.env. Already in process.env by the time this
//      config loads.
//   2. `forge/.env` — gitignored, scaffolded by /forge init with comments
//      only. Fill in the keys your hints declare. Re-running /forge init
//      preserves your values (idempotent).
//   3. `<project-root>/.env` — loaded if it exists, NOT scaffolded by
//      forge-init (we can't guarantee a gitignore at the project root
//      covers it, so we leave it to the user to add intentionally).
//
// dotenv's `override: false` default means values already in process.env
// are preserved, AND values set by an earlier dotenv call aren't clobbered
// by a later one. So forge/.env is loaded FIRST below — its values win over
// <project-root>/.env. The keys each spec needs are declared in your
// project's forge/hints/forge.md.
//
// Customize this when you DO want forge specs to use a config but don't
// want a project-wide one. Common additions:
//   - globalSetup: './global-setup.ts'      // e.g. clear DB before tests
//   - globalTeardown: './global-teardown.ts'
//   - use.baseURL: 'https://your.app/'
//   - reporter: [['list'], ['html']]
//   - timeout: 60_000
//
// Committed to the repo so teammates pick up the same fallback config.
import { defineConfig } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

// Playwright's config loader compiles .ts files as CJS, so __dirname and
// process are injected automatically. We declare them to satisfy
// TypeScript without pulling in @types/node as a dep just for this.
declare const __dirname: string
declare const process: { env: Record<string, string | undefined> }

// Load forge/.env (forge-specific overrides — wins), then <project-root>/.env
// (baseline — fills unset keys only). Both resolved from this config's
// directory so the loading works regardless of the runner's cwd.
loadEnv({ path: resolve(__dirname, '.env') })
loadEnv({ path: resolve(__dirname, '..', '.env') })

// FORGE_RECORD=1 enables Playwright's video + trace capture for this run.
// Set by `forge-pool-run-spec.mjs --record` (used by the verifier teammate
// in spec mode). If your project has its own playwright config, opt in by
// checking the same env var — that keeps spec-mode video recordings
// behaving consistently regardless of which config is in effect.
const record = process.env.FORGE_RECORD === '1'

export default defineConfig({
  testDir: './specs',
  // Pin output to forge/test-results regardless of cwd so test artifacts
  // (including recorded video.webm + trace.zip) never land in the project
  // root (where they wouldn't be gitignored).
  outputDir: resolve(__dirname, 'test-results'),
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    video: record ? 'on' : 'off',
    trace: record ? 'on' : 'off',
  },
})
