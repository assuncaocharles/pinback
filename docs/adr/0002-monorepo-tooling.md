# 2. Monorepo tooling

Date: 2026-11-27
Status: Accepted

## Context

Five packages share types and must build, lint and test together. The widget
ships as a single IIFE file with a 30 KB gzip budget.

## Decision

- **pnpm workspaces**, pinned with `packageManager`.
- **TypeScript 6.0.x**, strict, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. TS 7 is out, but typescript-eslint 8 supports
  only `<6.1`. Upgrade when typescript-eslint does.
- **Source-first workspace exports.** Each library's `exports` points at
  `src/index.ts` and `publishConfig.exports` points at `dist/`. Vite, Vitest
  and `tsc` read sources directly in the repo, so there is no build-order
  dependency during development. Published packages use compiled output.
- **Build:** `tsc` for `core` and `source-plugin`. Vite library mode for the
  widget (IIFE for the script tag, ESM for bundler users). Wrangler for the
  worker.
- **Tests:** a single root Vitest config with `projects`, so `pnpm test` runs
  everything. DOM tests opt into `happy-dom` per file. Playwright e2e tests in
  `e2e/` run against the built example app.
- **Lint:** ESLint flat config with `typescript-eslint` `strictTypeChecked`.
- **Size:** `size-limit` checks the widget IIFE against 30 KB gzip in CI.
- **Versioning:** Changesets. The example and the worker are private and
  ignored.

## Consequences

- The widget bundles `core` from source, so `core` must stay tree-shakeable
  (`sideEffects: false`).
- Locally, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a preinstalled
  Chromium instead of the version that `@playwright/test` expects.
