# Source-line comments

When a pinned element came from a component that the PR changes, the pin is
posted as a **review comment on that file and line**, next to the code, not
in the PR conversation. This needs the source plugin
(`@assuncaocharles/pinback-source-plugin`) in your preview builds. Without it, every pin
is a plain PR comment.

## How the line is found

1. In preview builds, the Vite plugin adds
   `data-pp-src="<repo-relative path>:<line>:<col>"` to every host JSX element
   (`<div>`, `<button>`…). Components (`<Card>`, `<motion.div>`) are left alone
   because they may not forward the attribute to the DOM. Paths are relative
   to the git root, so they match the PR diff.
2. A pin stores the nearest `data-pp-src` of the clicked element as
   `anchor.source`.
3. When the pin is posted, the auth frame lists the PR's changed files
   (`GET /pulls/{n}/files`) and applies the rules below.

## Rules

| # | Situation | Result |
| --- | --- | --- |
| 1 | The file is in the diff and the element's line is inside a hunk (an added or context line, new side) | Review comment on that line |
| 2 | The file is in the diff with hunks, but the element's line isn't in one | Review comment on the **nearest** commentable line (ties go to the earlier line). The footer says where the element really is: `element at path:line` |
| 3 | The file isn't in the diff, was removed, or has no patch (binary or too large) | Plain PR comment |
| 4 | GitHub rejects the review comment (e.g. 422 because the PR moved on and the line is no longer in the diff at that commit) | Plain PR comment |
| 5 | The preview's commit SHA isn't a full 40-character SHA, or the pin has no source | Plain PR comment |

Review comments always target `commit_id` = the commit the preview was built
from, on the `RIGHT` side.

## Threads, replies and resolving

- **Replies** to a review-comment pin are posted as native review replies
  (`POST /pulls/{n}/comments/{id}/replies`), so they stay in the thread on
  GitHub. Replies typed in GitHub's own review UI show up in the widget too.
- **Resolved state:** when signed in, the widget reads GitHub's review-thread
  `isResolved` (GraphQL), which wins over pinback state events. Resolving
  or reopening from the widget posts a state event **and** resolves or
  unresolves the GitHub thread, so both sides agree. Anonymous readers rely on
  the state events (ADR 5).
- A review comment whose code later changes shows as "outdated" on GitHub,
  just like any review comment. In the preview, its pin follows the element
  through M3 anchoring, where `source` is the strongest signal.

## Setup

```ts
// vite.config.ts
import { pinbackSource } from '@assuncaocharles/pinback-source-plugin';

export default defineConfig({
  plugins: [pinbackSource(), react()],
});
```

The plugin is off unless `PREVIEW_PINS=1` is set (or `enabled: true`), so
production builds are untouched. Set `repoRoot` if the git root can't be found
from the Vite root.
