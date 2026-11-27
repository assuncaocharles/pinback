# @assuncaocharles/pinback-core

## 0.1.0

### Minor Changes

- dc8f285: Read-only pins: fetch PR comments (ETag-cached), parse v1 metadata, build threads with resolve/reopen events, anchor and render numbered pins, thread dialog and comment list with outdated state.
- 064e695: Auth and writing: sign in with a GitHub App through an isolated auth frame (the token never reaches the page), pick elements with pointer or keyboard, post pins with a markdown preview, reply, and resolve/reopen threads.
- 1722489: Robust anchoring: candidates are scored against every stored selector (source, testId, text, context, CSS path, tag) with missing-signal and contradiction rules; low-confidence pins are shown as approximate and lost elements go outdated. CSS paths may use stable class names; text context skips same-text wrappers.
- 383b262: Source-line comments: the Vite plugin tags host JSX elements with `data-pp-src`; pins on files in the PR diff become review comments on the right line (nearest hunk line, else a plain PR comment). Review replies stay in their thread, GitHub-native replies appear in the widget, and review-thread resolved state syncs both ways when signed in.
- 44fe4a3: Optional screenshots: when the auth worker has an R2 bucket, the composer offers "Attach screenshot". The page around the pinned element is captured by a lazily loaded module (pinback-capture.mjs), uploaded through the auth frame, verified and stored by the worker, and embedded in the comment.
