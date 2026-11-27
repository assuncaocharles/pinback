# 6. Reading and rendering comments without a token

Date: 2026-11-27
Status: Accepted

## Context

M1 is read-only and has no auth. Anonymous GitHub API calls are limited to
60 per hour per IP, and every reviewer on the same office network shares
that limit. Comment bodies are markdown that must be displayed inside an
arbitrary host page.

## Decision

**Fetching**
- `GET /repos/{o}/{r}/issues/{n}/comments` and `/pulls/{n}/comments` (review
  comments, for M4), `per_page=100`, following `Link: rel="next"`. Pages
  are capped at 50.
- Each page is cached in memory with its `ETag` and re-requested with
  `If-None-Match` and `cache: 'no-store'`, so the browser cache doesn't
  hide the 304. A 304 doesn't count against the rate limit.
- The widget refreshes every 60 s while the tab is visible, and when the tab
  becomes visible again. With no changes this costs zero rate limit.
- A 404 is reported as "private repos need sign-in", since GitHub returns
  404 for private repos without a token. Rate limiting shows the reset
  time.

**Rendering**
- Request `application/vnd.github.full+json` to get both `body` (raw
  markdown, for our metadata) and `body_html` (GitHub-rendered). This avoids
  shipping a markdown renderer and matches GitHub's rendering exactly.
- `body_html` is sanitized **again** in the widget with an allowlist (tags,
  attributes, https-only images, safe link schemes, `rel="noopener
  noreferrer nofollow"`). Parsing happens in an inert `<template>`. A forge
  bug must not become an XSS on every preview.
- Our footer line is stripped from the rendered HTML.

**Positioning**
- Pins live in a fixed, full-viewport layer inside the shadow root
  (`pointer-events: none` except on the pins). Positions update in one rAF:
  all `getBoundingClientRect` reads first, then all transform writes.
- A `MutationObserver` on `document.body` re-runs anchoring, at most once
  per frame, so pins appear when an SPA renders late and move when it
  re-renders. Our own updates happen in the shadow tree and don't trigger
  the observer.

## Consequences

- No markdown dependency, and rendering is identical to GitHub's.
- Polling a PR with no new comments is free. A changed PR costs 2+ requests
  per refresh per viewer.
- The composer preview (M2) can't use `body_html`. It will need GitHub's
  `POST /markdown` (authenticated) or a small renderer, to be decided in M2.
