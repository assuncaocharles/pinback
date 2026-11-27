# 11. Optional pin screenshots in R2

Date: 2026-11-27
Status: Accepted

## Context

A screenshot makes a comment easier to understand on GitHub, where the
preview isn't visible. This is the M5 stretch goal. It's the first feature
that stores data outside GitHub, and browsers have no API for screenshotting
part of a page.

## Decision

- **Opt-in at every level.** The worker stores screenshots only if an R2
  bucket is bound as `SCREENSHOTS`. The frame reports that in `hello`, and
  only then does the composer show **Attach screenshot**, which is off by
  default.
- **Capture in the browser** with `modern-screenshot` (MIT, no dependencies),
  in a separate lazy module (`pinback-capture.mjs`, about 10 kB gz with
  its own size budget). It loads from next to the widget script only when a
  reviewer actually attaches a screenshot. It renders the DOM to a canvas,
  leaves out the widget itself, and crops the element plus 48 px of padding
  (at least 480×260 CSS px, inside the viewport) to WebP. It falls back to
  PNG and caps the result at 2 MB. Alternatives considered: `getDisplayMedia`
  (a permission prompt every time, current-tab preselection only in Chrome)
  and Cloudflare Browser Rendering in the worker (needs the paid plan).
- **Upload through the auth frame.** The frame POSTs the bytes to the
  worker's `/screenshots` route with the reviewer's token. The worker:
  - accepts same-origin requests only (from the frame);
  - checks `ALLOWED_REPOS`;
  - checks the bytes are a PNG, JPEG or WebP by their magic bytes, max 2 MB;
  - **verifies the token can see the repo** (`GET /repos/{owner}/{repo}`), so
    it isn't an open file host;
  - then stores the object as `owner/repo/<128-bit random>.<ext>`.
- **Serving:** `GET /s/<key>` is public, so GitHub's image proxy can fetch
  it. The content type is derived from the key, not from anything the client
  sent. Responses carry `Content-Security-Policy: default-src 'none';
  sandbox`, `nosniff` and long immutable caching.
- **Embedding:** the frame builds the comment body and only embeds URLs on
  its own `/s/` path.

## Consequences

- **Screenshots are public by URL.** Anyone who has the link can see the
  image. The key is unguessable, but for **private repos** this can leak UI
  that people who can't access the repo shouldn't see. That's why it's off
  by default. Enable it only if that's acceptable, and consider an R2
  lifecycle rule (for example, delete after 90 days).
- Deleting a comment doesn't delete its screenshot (the worker stays
  stateless about comments). Lifecycle rules handle retention.
- DOM capture can miss cross-origin images, canvases, iframes and some CSS.
  It's a best-effort snapshot, not a pixel-perfect one.
- The worker sees the reviewer's token briefly while verifying an upload. It
  already handles tokens during OAuth and never stores them.
