# 7. Token isolation: auth frame and sealed sign-in handoff

Date: 2026-11-27
Status: Accepted

## Context

The GitHub user token must never be readable by the preview page's
JavaScript, because an XSS bug in a preview must not be able to steal tokens.
The preview can be on any origin. The auth worker must stay stateless.

Two browser behaviours shape the design:

- **Storage partitioning.** An iframe from `auth.example.dev` embedded in
  `pr-1.foo.pages.dev` gets storage keyed by (top-level site, frame origin).
  A first-party popup on the worker's origin **cannot** share
  localStorage, BroadcastChannel or cookies with that iframe.
- **The OAuth popup may lose `window.opener`** if any page in the redirect
  chain sets a Cross-Origin-Opener-Policy, so we can't rely on it alone.

## Decision

1. **Auth frame.** The widget embeds a hidden iframe from `{worker}/frame`.
   All authenticated GitHub calls happen inside it, and the token lives only
   in its (partitioned) localStorage. The frame is protected by:
   - `Content-Security-Policy: frame-ancestors <ALLOWED_ORIGINS>`, so only
     allowlisted previews can embed it;
   - `script-src 'self'` and `connect-src 'self' https://api.github.com`;
   - an origin allowlist check plus `event.source === window.parent` on
     every message. The first `hello` pins the parent origin, and replies
     target only that origin.
2. **Typed RPC.** A fixed set of methods (`hello`, `redeem`, `signOut`,
   `listComments`, `createComment`, `renderMarkdown`, `canMaintain`), all
   validated. No message from the frame ever contains the token. The frame
   builds comment bodies itself from `{text, meta}`, so metadata is always
   well-formed. `ALLOWED_REPOS` can restrict which repos it acts on.
3. **Sealed handoff, bound to the frame.**
   - The frame keeps a random **secret** in its storage and gives the widget
     only `challenge = SHA-256(secret)`.
   - Sign-in opens a popup to `/auth/start?challenge=…&return=…`. The worker
     checks the return origin against the allowlist, stores
     `{state, PKCE verifier, challenge}` in a short-lived `__Host-` HttpOnly
     cookie, and redirects to GitHub (PKCE S256).
   - `/auth/callback` checks `state`, exchanges the code (with the client
     secret and verifier), and **seals** `{tokens, challenge, iat}` with
     AES-256-GCM under `SESSION_KEY`. The page contains only the blob.
   - The blob reaches the host page through `window.opener.postMessage`
     (targeted at the preview origin), or, if the opener is gone, by
     redirecting to `return#pp_auth=<blob>`.
   - The widget passes the blob to the frame. The frame POSTs
     `{blob, secret}` to `/auth/redeem` (same-origin only). The worker
     decrypts the blob, checks `SHA-256(secret) === challenge` and its
     10-minute expiry, and returns the tokens **to the frame**. The frame
     then rotates its secret.
4. **Refresh.** GitHub App user tokens expire after 8 h. The frame refreshes
   through `/auth/refresh` (same-origin only), and the client secret never
   leaves the worker.

## Consequences

- An XSS on the preview **cannot read the token**. It can see the sealed
  blob, but can't redeem it without the frame's secret. `/auth/redeem` also
  refuses cross-origin callers. An e2e test asserts the token never appears
  in host storage, DOM, globals or received messages, and that a captured
  blob can't be redeemed from the host page.
- An XSS **can ask the frame to act** (post a comment as the user) while the
  page is open, just as CSRF can on any site. The methods are narrow and
  scoped to PR comments, and `ALLOWED_REPOS` limits the blast radius.
- The token is per top-level site (partitioned), so reviewers sign in once
  per preview project, not once per PR. Browsers that clear third-party
  storage aggressively will ask more often.
- The worker stores nothing. Rotating `SESSION_KEY` only invalidates
  in-flight sign-ins.
- If popups are blocked, sign-in falls back to a same-tab redirect, and an
  unsent draft is lost (acceptable for v1).
