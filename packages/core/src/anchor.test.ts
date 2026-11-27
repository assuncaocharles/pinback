// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { cssPath, describeElement, resolveAnchor } from './anchor.js';

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

describe('anchoring (M1)', () => {
  beforeEach(() => {
    document.body.innerHTML = page;
  });

  it('builds a css path from the nearest stable id, ignoring classes', () => {
    expect(cssPath($('li:nth-of-type(2) span'))).toBe('#app > section > ul > li:nth-of-type(2) > span:nth-of-type(1)');
  });

  it('skips generated-looking ids', () => {
    document.body.innerHTML = '<div id=":r1:"><p>a</p><p>b</p></div>';
    expect(cssPath($('p:nth-of-type(2)'))).toBe('body > div > p:nth-of-type(2)');
  });

  it('describes an element with all available selectors', () => {
    const a = describeElement($('li:nth-of-type(2) span'));
    expect(a.testId).toBe('item-mug');
    expect(a.textQuote).toEqual({ exact: 'Enamel mug', prefix: '', suffix: '$16' });
  });

  it('resolves an unchanged page by css path', () => {
    const el = $('button');
    expect(resolveAnchor(document, describeElement(el))).toBe(el);
  });

  it('survives reordered siblings via testId + text', () => {
    const anchor = describeElement($('li:nth-of-type(2) span'));
    const ul = $('ul');
    ul.prepend(ul.lastElementChild!); // mug is now first
    const el = resolveAnchor(document, anchor);
    expect(el?.textContent).toBe('Enamel mug');
  });

  it('falls back to text when testIds and structure change', () => {
    const anchor = describeElement($('button'));
    document.body.innerHTML = '<div><footer><button>Place order</button></footer></div>';
    expect(resolveAnchor(document, anchor)?.tagName).toBe('BUTTON');
  });

  it('returns null when the element is gone', () => {
    const anchor = describeElement($('button'));
    $('button').remove();
    expect(resolveAnchor(document, anchor)).toBeNull();
  });

  it('never resolves into the ignored subtree', () => {
    document.body.innerHTML = '<div id="widget"><button>Place order</button></div>';
    expect(resolveAnchor(document, { textQuote: { exact: 'Place order', prefix: '', suffix: '' } }, { ignore: $('#widget') })).toBeNull();
  });

  it('tolerates an invalid stored css path', () => {
    expect(resolveAnchor(document, { cssPath: '>>><<' , testId: 'checkout' })).toBe($('button'));
  });
});
