# 3. Cloudflare Pages for the demo's per-PR previews

Date: 2026-11-27
Status: Accepted

## Context

M0 requires the demo app to be deployed per PR. The widget itself must work on
any static host. This ADR covers only where *our* demo runs.

## Decision

Deploy `examples/react-vite` with `wrangler pages deploy --branch pr-<n>`
from GitHub Actions. This gives a stable URL per PR
(`https://pr-<n>.<project>.pages.dev`).

- The auth worker already uses Cloudflare, so there is one account and one
  CLI to manage.
- The deploy is driven from Actions instead of Cloudflare's Git integration,
  so we control the build env vars that produce the `pinback` meta tag.
- GitHub Pages was rejected because it has no native per-PR previews.

## Consequences

- The repo needs `CLOUDFLARE_API_TOKEN` (Pages: Edit) and
  `CLOUDFLARE_ACCOUNT_ID` secrets, and the Pages project must exist.
  Without them the deploy step logs a warning and is skipped.
- Fork PRs get no secrets, so they get no preview.
- The worker's `ALLOWED_ORIGINS` will need `https://*.<project>.pages.dev`.
