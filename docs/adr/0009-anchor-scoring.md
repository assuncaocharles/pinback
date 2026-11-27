# 9. Anchoring by confidence scoring

Date: 2026-11-27
Status: Accepted (supersedes the ordered lookup used in M1)

## Context

M1 tried selectors in a fixed order and took the first hit. That fails in
both directions after real refactors. A stale CSS path happily points at
whatever element now sits in that slot (a wrong pin). A lost testId sends the
lookup straight to a text match even when the rest of the page disagrees.
Pins must survive class renames, reordering, wrappers and text tweaks. When
the element is really gone they must go **outdated**, never jump to the wrong
element.

## Decision

**Candidates** come from every selector: elements with the stored `source`
(or the same file), the `testId` bearer and its descendants, the `cssPath`
target, and elements whose text exactly or fuzzily (Dice ≥ 0.5) matches the
quote.

**Each candidate is scored against all signals** and the weighted mean is
its confidence (0..1):

| Signal | Weight | Value |
| --- | --- | --- |
| source | 3 | 1 for the exact `path:line:col` or the same file and line; 0.3 for the same file only |
| testId | 3 | 1 if the candidate's nearest `data-testid` matches |
| text | 2 | Dice bigram similarity to the quote |
| context | 1.5 | share of prefix/suffix found in the context text |
| cssPath | 1 | 1 if the candidate is the path's target |
| tag | 0.5 | 1 if the tag matches the path's last step |

Rules on top of the weighted mean:

- **Missing ≠ mismatch.** A testId, source, context or CSS path that matches
  *nothing anywhere on the page* counts at 30% weight. It's evidence of a
  refactor, not evidence against a candidate.
- **Contradiction veto.** If the text contradicts the quote (similarity
  < 0.3) and neither testId nor source confirms the identity, confidence is
  capped below the threshold. This is the "a different button now sits where
  ours was" case.
- **Thresholds:** confidence ≥ 0.5 places the pin. Below 0.7, or within 0.05
  of an unrelated rival (ambiguous), the pin is drawn dashed and labelled
  "approximate position".
- **Ties** go to the deeper element (the button, not its same-text wrapper).

**Generation changes:**

- CSS paths may use a class name when it's stable-looking (no hashes, no
  CSS-in-JS prefixes, no digit runs) and singles the element out among its
  siblings. Otherwise they use `:nth-of-type`.
- Text context comes from the nearest ancestor whose text is longer than the
  element's, so adding or removing a same-text wrapper doesn't change it.

**Performance:** one `AnchorIndex` (a page scan) is built per re-anchor pass
and shared by all pins.

## Consequences

- A 20-case refactor fixture suite (`anchor.fixtures.ts`) pins the
  behaviour, including the negative cases (removed element, swapped-in
  sibling, shifted list). An e2e test loads pins recorded against an older
  build of the demo.
- Weights are heuristics. New fixtures should come with any change to them.
- The format is unchanged (v1). Old anchors keep working, and their context
  may have been taken from the direct parent, which the scorer tolerates.
