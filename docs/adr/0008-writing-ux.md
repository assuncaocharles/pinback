# 8. Writing: comment mode, composer preview, resolve permissions

Date: 2026-11-27
Status: Accepted

## Context

M2 adds writing. The spec requires full keyboard operation, the dialog
pattern for the composer and thread views, and a markdown preview.

## Decision

- **Comment mode** captures `pointerdown`, `mousedown`, `mouseup` and
  `click` on the document while active, so the app never reacts to the
  picking click. Hovering outlines the target.
- **Keyboard picking:** arrow keys walk the DOM from `<main>` (Down = first
  child, Up = parent, Left/Right = siblings), Tab-focus highlights focusable
  elements, Enter picks, and Escape exits. A live region announces the
  current target ("button “Place order”"). Keys typed into text fields are
  never intercepted.
- **Picking exits comment mode.** One pin per toggle keeps the page usable,
  and toggling back on is one click.
- **Composer:** a native modal `<dialog>` with Write/Preview tabs (ARIA
  tabs, arrow-key switching) and Ctrl/Cmd+Enter to post. Signed out, the
  submit button reads "Sign in with GitHub" and the draft is kept.
- **Preview** uses GitHub's `POST /markdown` (GFM, repo context) through the
  frame, so it matches GitHub exactly and ships no markdown renderer. This
  resolves the open question in ADR 6. It needs sign-in, which writing needs
  anyway.
- **Resolve/Reopen** is shown to the thread's author and to users with push
  access (`GET /repos/{o}/{r}` → `permissions`). This matches the readers'
  rule in ADR 5 (author, owner, member or collaborator).
- **Optimistic local comments:** a posted comment is merged into the list
  right away and kept until the server's list includes it, so a stale
  in-flight refresh can't make it vanish.

## Consequences

- Picking can't target elements inside closed shadow roots or cross-origin
  iframes. That's acceptable for v1.
- Pressing Enter on the widget's own toggle still toggles unless the user
  has started choosing with the arrow keys.
