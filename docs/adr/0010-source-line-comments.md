# 10. Source-line comments and their fallbacks

Date: 2026-11-27
Status: Accepted

## Context

A comment about a component is most useful next to its code. The spec asks
for pins on elements from files in the PR diff to land as review comments on
the right file and line, with documented fallbacks.

## Decision

- **Tagging:** a Vite plugin built on `@babel/core` (the only new dependency,
  used at build time only) adds `data-pp-src="path:line:col"` to host JSX
  elements in preview builds. Babel's parser handles TSX directly
  (`parserOpts.plugins: ['jsx', 'typescript']`), so no preset is needed.
  `retainLines` keeps line numbers stable for later transforms.
- **Components are not tagged:** passing an unknown prop to a component can
  break it or leak into its props. The nearest host element inside it carries
  the location, which is where the reviewer clicked anyway.
- **The decision is made in the auth frame,** not the widget. The frame
  already holds the token, can list PR files, and builds every comment body,
  so the host page can't steer a comment to an arbitrary path.
- **Fallback rules** are in `docs/source-line-comments.md`. Every failure ends
  in a plain PR comment, never a lost comment.
- **Review threads:** replies use the native reply endpoint, and GitHub's
  `isResolved` (GraphQL) is authoritative when signed in. Resolving from the
  widget mirrors to GitHub on a best-effort basis (updates ADR 5).

## Consequences

- Line mapping uses the PR's *current* diff, while the comment targets the
  preview's commit. If they differ and the line isn't commentable at that
  commit, GitHub returns 422 and rule 4 applies.
- Tagged builds are slightly larger (one attribute per host element). This
  only affects preview builds.
- Anonymous readers see review-thread state only via state events, so a
  thread resolved in GitHub's UI still shows open to them.
