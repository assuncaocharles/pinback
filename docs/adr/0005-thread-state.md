# 5. Resolved state for plain PR comments

Date: 2026-11-27
Status: Accepted

## Context

Resolved pins must be hidden. Review comments (M4) have a native resolved
state (GraphQL `reviewThreads.isResolved`), but plain PR comments don't, and
GraphQL needs a token, so anonymous readers can't use it. The spec asks us to
choose between a metadata update and a reaction convention.

Options:

1. **Edit the root's metadata** to `resolved: true`. Only the comment's
   author or a user with write access can edit it. The edit leaves no
   visible trace in the conversation, and editing someone else's comment
   body to resolve it feels wrong.
2. **Reaction convention** (for example ✅ = resolved). Anyone can react,
   reactions carry no "reopen" semantics, and reading them costs an extra API
   request per thread.
3. **State-event replies.** Resolving posts a reply whose metadata has
   `"state": "resolved"` (or `"open"` to reopen). This is append-only.

## Decision

Option 3: state-event replies.

- A thread's state is the `state` of its **latest** state event from an
  **authorised** user: the root comment's author, or anyone whose
  `author_association` is `OWNER`, `MEMBER` or `COLLABORATOR`. Events from
  other users are ignored.
- A state event may carry text ("Fixed in abc123"), which is shown as a
  normal reply. An empty event is rendered only as state.
- Review-comment threads (M4) use GraphQL `isResolved` when a token is
  available and fall back to state events when it isn't.

## Update (M4, ADR 10)

Implemented as planned. When signed in, the frame reads `reviewThreads.isResolved`
via GraphQL and it wins for review threads. Resolving from the widget posts
the state event and also resolves the GitHub thread, best-effort.

## Consequences

- No extra requests: state comes from the same comment list we already
  fetch, which works anonymously and with ETags.
- History is visible on GitHub ("✅ Resolved via pinback"), and reopen is
  just another event.
- Resolving adds a comment to the PR. This is acceptable, since GitHub's own
  "resolve conversation" also shows in the timeline.
- `author_association` comes from GitHub, so it can't be forged in metadata.
