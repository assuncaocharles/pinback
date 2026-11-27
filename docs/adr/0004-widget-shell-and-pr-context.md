# 4. Widget shell and PR context

Date: 2026-11-27
Status: Accepted

## Context

The widget must drop into arbitrary pages without style conflicts, load from
one `<script>` tag, and know which PR it belongs to.

## Decision

- **Custom element `<pinback-widget>` with an open shadow root.** Styles are
  scoped by the shadow root, and `:host { all: initial }` blocks inherited
  properties. The shadow root is *open*. A closed root adds no real security,
  because host JS runs in the same realm and can patch `attachShadow`. Token
  safety comes from the auth iframe (M2), not from shadow DOM.
- **Auto-mount.** Loading the script defines the element and appends one
  instance to `<body>` if the page has none. Opt out with `data-no-auto-mount`
  on the script tag.
- **Meta tag format.** The meta tag looks like this:
  `<meta name="pinback" content="owner=acme;repo=web;pr=42;sha=<40-hex>">`.
  Use `key=value;` pairs, which are easy to write from shell in CI.
- **Query params** are prefixed (`pp_owner`, `pp_repo`, `pp_pr`, `pp_sha`)
  so they don't collide with the app's own params.
- **Resolution** is per field, in this order: meta tag, then query params,
  then the element's `config` property. A field missing from one source can
  come from a later one. Values are validated (owner and repo name charset, a
  positive integer PR number, a 7 to 40 character hex SHA) before they reach
  any API URL.

## Consequences

Because resolution is per field, a page can bake in owner and repo and let a
query param pick the PR. Anything the page passes in is untrusted input.
