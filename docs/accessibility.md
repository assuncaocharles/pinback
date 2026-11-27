---
description: "How the pinback widget supports keyboard and screen-reader users, and how axe runs in CI."
---

# Accessibility

The widget aims for WCAG 2.2 AA. This page covers what's checked
automatically, the keyboard model, and the manual screen-reader pass.

## Automated (CI)

`e2e/a11y.spec.ts` runs axe (`@axe-core/playwright`, tags `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`) scoped to
`<pinback-widget>`. axe reaches into the shadow root. It checks every widget
state in **light and dark** color schemes:

- toolbar with pins (including an approximate pin);
- comment list (on this page, outdated, other pages, resolved), signed out
  and signed in;
- thread view signed out (sign-in prompt) and signed in (reply box,
  Resolve);
- comment mode with the hover outline;
- composer, Write and Preview tabs.

The build fails on any violation. Issues found and fixed when this was
added:

- **Label in name (2.5.3):** the Comments button and list items had
  `aria-label`s that didn't contain their visible text. Speech-input users
  couldn't "click Comments 2". The names are now the visible text plus
  screen-reader-only words.
- **Contrast (1.4.3):** while hovered, the expanded Comments button and the
  pressed Comment toggle lost their accent background but kept light text.

## Keyboard

| Where | Keys |
| --- | --- |
| Toolbar | Tab to **Comment** (toggle comment mode) and **Comments** (open the list) |
| Comment list | Opens with focus on its first item. Tab and Shift+Tab move through items, Enter opens one, Escape closes the list and returns focus to **Comments** |
| Pins | Each pin is a button in tab order, labelled "Comment N by login, K replies: excerpt" (plus "approximate position" when relevant). Enter opens the thread |
| Comment mode | Arrow Down: first child (starts at `<main>`). Arrow Up: parent. Arrow Left/Right: siblings. Enter: pin the highlighted element. Escape: leave comment mode. Tab-focusing a page element also highlights it. The current target is announced ("button “Place order”") |
| Dialogs (thread, composer) | Native modal `<dialog>`: focus moves into it, Tab stays inside, Escape closes and focus returns to the pin or button that opened it |
| Composer | Arrow Left/Right switch the Write and Preview tabs. Ctrl/Cmd+Enter posts |

Comment mode never captures keys typed into text fields, on the page or in
the widget.

## Motion and color

- `prefers-reduced-motion: reduce` turns off transitions and makes
  scroll-into-view instant.
- `prefers-color-scheme: dark` switches every widget color token. Both
  schemes are audited.
- Approximate pins use a dashed outline **and** a text label, not color
  alone.

## Manual screen-reader pass

axe can't judge reading order, announcements or how the dialogs feel in
use. A person needs to do this pass with a real screen reader. **It has not
been done yet.** Record results here.

Run on the demo preview, signed in, with one comment, one reply, one
outdated pin and one resolved thread.

| # | Step | Expected | NVDA + Firefox | VoiceOver + Safari |
| --- | --- | --- | --- | --- |
| 1 | Tab to the toolbar | "Preview comments, toolbar", then "Comment, toggle button, not pressed" | ☐ | ☐ |
| 2 | Activate **Comment** | "Comment mode on. Click an element, or use arrow keys…" | ☐ | ☐ |
| 3 | Arrow Down twice, Arrow Right | Each move announces the highlighted element | ☐ | ☐ |
| 4 | Enter | "New comment, dialog". Focus is in the comment text field and the target ("On button …") is readable | ☐ | ☐ |
| 5 | Switch to Preview with arrows, then back | Tabs are announced with their selected state | ☐ | ☐ |
| 6 | Post with Ctrl+Enter | "Comment posted". Focus returns to **Comment** | ☐ | ☐ |
| 7 | Tab to a pin | "Comment 1 by …, 1 reply: …, button" | ☐ | ☐ |
| 8 | Enter on the pin | "Comment 1, dialog", heading focused. Comments read in order, then the reply box | ☐ | ☐ |
| 9 | Escape | The dialog closes and focus returns to the pin | ☐ | ☐ |
| 10 | Open **Comments** | "Comments 2 open on this page, expanded". Group headings ("On this page", "Outdated") are navigable | ☐ | ☐ |
| 11 | Outdated item | Announces its SHA ("pinned at …") | ☐ | ☐ |
| 12 | Resolve a thread | "Thread resolved". The pin disappears and focus doesn't get lost | ☐ | ☐ |
