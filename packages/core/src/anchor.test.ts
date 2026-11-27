// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnchorIndex,
  cssPath,
  describeElement,
  isStableClass,
  isStableId,
  matchAnchor,
  resolveAnchor,
  similarity,
} from './anchor.js';

const page = `
  <main id="app">
    <section data-testid="cart">
      <h2>Your cart</h2>
      <ul>
        <li data-testid="item-tee"><span>Logo tee</span><span>$24</span></li>
        <li data-testid="item-mug"><span>Enamel mug</span><span>$16</span></li>
      </ul>
      <p>Total <strong>$40</strong></p>
      <button class="css-1x9fz2" data-testid="checkout">Place order</button>
    </section>
  </main>`;

const $ = (sel: string) => document.querySelector(sel)!;

describe('generation', () => {
  beforeEach(() => {
    document.body.innerHTML = page;
  });

  it('builds a css path from the nearest stable id, ignoring generated classes', () => {
    expect(cssPath($('li:nth-of-type(2) span'))).toBe('#app > section > ul > li:nth-of-type(2) > span:nth-of-type(1)');
    expect(cssPath($('button'))).toBe('#app > section > button');
  });

  it('uses a stable class instead of a position when it singles out the element', () => {
    document.body.innerHTML = '<nav id="n"><a class="link">A</a><a class="link active">B</a><a class="link">C</a></nav>';
    expect(cssPath($('a.active'))).toBe('#n > a.active');
  });

  it('skips generated-looking ids', () => {
    document.body.innerHTML = '<div id=":r1:"><p>a</p><p>b</p></div>';
    expect(cssPath($('p:nth-of-type(2)'))).toBe('body > div > p:nth-of-type(2)');
  });

  it('takes context from the nearest ancestor that adds text', () => {
    document.body.innerHTML = '<p>Total <span><b>$40</b></span> incl. tax</p>';
    expect(describeElement($('b')).textQuote).toEqual({ exact: '$40', prefix: 'Total', suffix: 'incl. tax' });
  });

  it('describes an element with all available selectors', () => {
    const a = describeElement($('li:nth-of-type(2) span'));
    expect(a.testId).toBe('item-mug');
    expect(a.textQuote).toEqual({ exact: 'Enamel mug', prefix: '', suffix: '$16' });
  });
});

describe.each([
  ['header', true],
  ['primary-button', true],
  ['card__title--active', true],
  ['css-1x9fz2', false],
  ['sc-bdVaJa', false],
  ['jsx-1234', false],
  ['Button_root__a1B2c', false],
  ['_3xYz9', false],
  ['emotion-0', false],
])('isStableClass(%s)', (cls, stable) => {
  it(`is ${String(stable)}`, () => {
    expect(isStableClass(cls)).toBe(stable);
  });
});

describe.each([
  ['checkout', true],
  [':r1:', false],
  ['a1b2c3d4e5', false],
  ['item-12345', false],
])('isStableId(%s)', (id, stable) => {
  it(`is ${String(stable)}`, () => {
    expect(isStableId(id)).toBe(stable);
  });
});

describe('similarity', () => {
  it('is 1 for equal strings and low for unrelated ones', () => {
    expect(similarity('Place order', 'Place order')).toBe(1);
    expect(similarity('Place order', 'Place your order')).toBeGreaterThan(0.7);
    expect(similarity('Delete', 'Archive')).toBeLessThan(0.3);
  });
});

describe('resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = page;
  });

  it('is confident on an unchanged page', () => {
    const m = matchAnchor(document, describeElement($('button')));
    expect(m?.element).toBe($('button'));
    expect(m?.confidence).toBe(1);
    expect(m?.ambiguous).toBe(false);
  });

  it('flags ambiguity between unrelated look-alikes', () => {
    document.body.innerHTML = '<div><button>OK</button></div><div><button>OK</button></div>';
    // Only the text is known: both buttons fit equally.
    const m = matchAnchor(document, { textQuote: { exact: 'OK', prefix: '', suffix: '' } });
    expect(m?.ambiguous).toBe(true);
  });

  it('never resolves into the ignored subtree', () => {
    document.body.innerHTML = '<div id="widget"><button>Place order</button></div>';
    const anchor = { textQuote: { exact: 'Place order', prefix: '', suffix: '' } };
    expect(resolveAnchor(document, anchor, { ignore: $('#widget') })).toBeNull();
  });

  it('tolerates an invalid stored css path', () => {
    expect(resolveAnchor(document, { cssPath: '>>><<', testId: 'checkout' })).toBe($('button'));
  });

  it('shares one index across anchors', () => {
    const index = new AnchorIndex(document);
    expect(resolveAnchor(document, describeElement($('button')), { index })).toBe($('button'));
    expect(resolveAnchor(document, describeElement($('strong')), { index })).toBe($('strong'));
  });

  it('resolves 50 anchors on a 2,000-element page quickly', () => {
    const rows = Array.from(
      { length: 400 },
      (_, i) => `<li data-testid="row-${i}"><span>Item ${i}</span><span>${i} USD</span><button>Edit</button></li>`,
    );
    document.body.innerHTML = `<ul id="big">${rows.join('')}</ul>`;
    const anchors = Array.from({ length: 50 }, (_, i) => describeElement($(`[data-testid="row-${i * 8}"] span`)));
    const t0 = performance.now();
    const index = new AnchorIndex(document);
    for (const a of anchors) resolveAnchor(document, a, { index });
    // Generous bound for slow CI DOM shims; real browsers are far faster.
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
