// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ANCHOR_THRESHOLD, describeElement, matchAnchor, resolveAnchor } from './anchor.js';
import { anchorFixtures } from './anchor.fixtures.js';

describe('anchoring survives refactors (fixtures)', () => {
  it.each(anchorFixtures.map((f) => [f.name, f] as const))('%s', (_, f) => {
    document.body.innerHTML = f.before;
    const target = document.querySelector(f.target);
    expect(target, `target ${f.target} in before`).not.toBeNull();
    const anchor = describeElement(target!);

    document.body.innerHTML = f.after;
    const resolved = resolveAnchor(document, anchor);
    const match = matchAnchor(document, anchor);
    const detail = `confidence=${match?.confidence.toFixed(2)} signals=${JSON.stringify(match?.signals)} picked=<${match?.element.outerHTML.slice(0, 80)}>`;

    if (f.expect === null) {
      expect(resolved, `should be outdated; ${detail}`).toBeNull();
    } else {
      const expected = document.querySelector(f.expect);
      expect(expected, `expected ${f.expect} in after`).not.toBeNull();
      expect(resolved, detail).toBe(expected);
      expect(match!.confidence).toBeGreaterThanOrEqual(ANCHOR_THRESHOLD);
    }
  });
});
