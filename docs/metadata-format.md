---
description: "The hidden metadata pinback stores in each GitHub comment: anchor, page, commit and thread fields (v1)."
---

# Comment metadata format (v1)

Every pin is an ordinary GitHub PR comment. The comment has three parts:

1. **The reviewer's text** (markdown), exactly as typed.
2. **A footer** that reads well on GitHub, e.g.
   `<sub>📌 Pinned on [/checkout](…) at abc1234 · pinback</sub>`.
   This is cosmetic only. The widget hides it and never parses it.
3. **A hidden metadata block**, an HTML comment that GitHub keeps in the raw
   body but doesn't render:

```
<!-- pinback:v1 {"anchor":{…},"viewport":{"w":1440,"h":900},"url":"/checkout","sha":"abc1234","parent":null} -->
```

## Syntax

```
<!-- pinback:v<VERSION> <JSON> -->
```

- One space after `<!--`, after the version and before `-->`.
- `VERSION` is a positive integer. This document specifies `1`.
- `JSON` is a single JSON object. Writers **must** escape every `<` as
  `<` and every `>` as `>`. These are standard JSON escapes, so
  any JSON parser restores the original strings. They guarantee the payload
  never contains `-->`, `--!>` or `<!--`, which would end or nest the HTML
  comment.
- If a body contains several blocks (for example, a reply that quotes another
  pin), readers use the **last** one. Writers append the block at the end of
  the body.
- Other `<!-- pinback:… -->` markers that don't match
  `pinback:v<digits> `, such as `pinback:deploy`, aren't metadata
  and are ignored.

## Fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `anchor` | object | yes | Selectors that locate the pinned element. See below. May be `{}` on replies. |
| `viewport` | `{ w: number, h: number }` | yes | Viewport size in CSS px when the pin was created. |
| `url` | string | yes | Pathname of the page, starting with `/`. Compared after stripping query, hash and trailing slashes. |
| `sha` | string | yes | Commit the preview was built from (7 to 40 hex characters). Shown for outdated pins. |
| `parent` | number \| null | yes | `null` for a root pin. For replies, the **root** comment's id (never another reply's). |
| `state` | `"resolved"` \| `"open"` | no | Only on replies. Marks a state change. See [ADR 5](adr/0005-thread-state.md). |

### `anchor`

All fields are optional. Readers ignore fields they don't understand or that
fail validation, but keep the pin.

| Field | Type | Meaning |
| --- | --- | --- |
| `testId` | string | Nearest `data-testid`, on the element itself or an ancestor. |
| `source` | string | Nearest `data-pp-src` (`path:line:col`), written by the source plugin (M4). |
| `cssPath` | string | Short CSS path from the nearest stable `id` (or `body`), using tag names, `:nth-of-type`, and stable-looking class names when they single the element out. Never uses generated class names. |
| `textQuote` | `{ exact, prefix, suffix }` | Whitespace-normalised text of the element (max 64 characters) and up to 32 characters of context from the nearest ancestor whose text is longer than the element's own. |
| `rect` | `{ x, y }` | Click position inside the element's box, as fractions from 0 to 1. Missing means the top-right corner (`{x:1,y:0}`). |

How readers resolve an anchor (confidence scoring, thresholds, outdated
state) is described in [ADR 9](adr/0009-anchor-scoring.md).

## Reader rules

- A block with an unknown version is ignored. The comment is treated as
  ordinary PR discussion.
- Invalid JSON, a non-object, or invalid required fields mean the whole
  block is ignored.
- Invalid optional anchor fields are dropped individually. `rect` values are
  clamped to the range 0 to 1.
- Replies whose `parent` doesn't match a root pin are dropped.

## Versioning

Additive, backwards-compatible fields can be added to `v1`. Readers must
ignore unknown fields. Any change that alters the meaning of an existing
field needs `v2`. Readers that only understand `v1` will ignore `v2` pins
rather than misplace them.

## Example

```markdown
The CTA blends into the card in dark mode. Can we bump contrast?

<sub>📌 Pinned on [`/checkout`](https://pr-12.example.pages.dev/checkout) at abc1234 · pinback</sub>

<!-- pinback:v1 {"anchor":{"testId":"checkout-button","cssPath":"#root > main > section > button","textQuote":{"exact":"Place order","prefix":"Total $62","suffix":""},"rect":{"x":0.85,"y":0.3}},"viewport":{"w":1440,"h":900},"url":"/checkout","sha":"abc1234","parent":null} -->
```
