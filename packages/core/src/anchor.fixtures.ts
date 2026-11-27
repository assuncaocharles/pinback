/**
 * Refactor fixtures for anchoring (M3). Each case pins an element on the
 * "before" page, applies a refactor, and states where the pin must land on the
 * "after" page: a selector, or null when the pin should go outdated rather
 * than jump to the wrong element.
 */
export interface AnchorFixture {
  name: string;
  before: string;
  /** Selector for the pinned element in `before`. */
  target: string;
  after: string;
  /** Selector for the expected element in `after`, or null for outdated. */
  expect: string | null;
}

const checkout = (opts: { btnClass?: string; btnText?: string; testId?: boolean; wrap?: boolean; items?: string } = {}) => {
  const btn = `<button class="${opts.btnClass ?? 'cta css-1x9fz2'}"${opts.testId === false ? '' : ' data-testid="checkout"'}>${opts.btnText ?? 'Place order'}</button>`;
  return `
<main id="app">
  <h1>Checkout</h1>
  <section class="card" data-testid="cart">
    <h2>Your cart</h2>
    <ul class="cart">
      ${opts.items ?? `
      <li data-testid="item-tee"><span>Logo tee</span><span>$24</span></li>
      <li data-testid="item-mug"><span>Enamel mug</span><span>$16</span></li>
      <li data-testid="item-cap"><span>Dad cap</span><span>$22</span></li>`}
    </ul>
    <p class="total">Total <strong data-testid="cart-total">$62</strong></p>
    ${opts.wrap ? `<div class="actions">${btn}</div>` : btn}
  </section>
</main>`;
};

const addresses = (first: 'shipping' | 'billing') => {
  const card = (kind: 'shipping' | 'billing') => `
    <section class="address">
      <h3>${kind === 'shipping' ? 'Shipping address' : 'Billing address'}</h3>
      <p>${kind === 'shipping' ? '1 Main St' : '9 Side Rd'}</p>
      <button>Edit</button>
    </section>`;
  const second = first === 'shipping' ? 'billing' : 'shipping';
  return `<main id="account">${card(first)}${card(second)}</main>`;
};

export const anchorFixtures: AnchorFixture[] = [
  {
    name: 'unchanged page',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: checkout(),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'generated class names renamed',
    before: checkout({ btnClass: 'css-1x9fz2 e1abc0' }),
    target: '[data-testid="checkout"]',
    after: checkout({ btnClass: 'css-9qq2kz e7zzz9' }),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'semantic class renamed',
    before: checkout({ btnClass: 'cta' }),
    target: '[data-testid="checkout"]',
    after: checkout({ btnClass: 'primary-button' }),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'list items reordered (testIds)',
    before: checkout(),
    target: '[data-testid="item-mug"] span:first-child',
    after: checkout({
      items: `
      <li data-testid="item-cap"><span>Dad cap</span><span>$22</span></li>
      <li data-testid="item-mug"><span>Enamel mug</span><span>$16</span></li>
      <li data-testid="item-tee"><span>Logo tee</span><span>$24</span></li>`,
    }),
    expect: '[data-testid="item-mug"] span:first-child',
  },
  {
    name: 'list items reordered (no testIds, distinct text)',
    before: '<ul id="l"><li>Alpha</li><li>Bravo</li><li>Charlie</li></ul>',
    target: 'li:nth-child(2)',
    after: '<ul id="l"><li>Charlie</li><li>Alpha</li><li>Bravo</li></ul>',
    expect: 'li:nth-child(3)',
  },
  {
    name: 'wrapper added around the element',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: checkout({ wrap: true }),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'wrapper removed',
    before: checkout({ wrap: true }),
    target: '[data-testid="checkout"]',
    after: checkout(),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'text tweaked',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: checkout({ btnText: 'Place your order' }),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'text rewritten, testId kept',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: checkout({ btnText: 'Pay now' }),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'testId removed, text and structure kept',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: checkout({ testId: false }),
    expect: 'button',
  },
  {
    name: 'testId removed and page restructured, unique text kept',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: '<main id="app"><h1>Checkout</h1><aside><p>Total $62</p><button>Place order</button></aside></main>',
    expect: 'button',
  },
  {
    name: 'element removed',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: checkout().replace(/<button[\s\S]*?<\/button>/, ''),
    expect: null,
  },
  {
    name: 'element removed, a different same-tag sibling takes its place',
    before: '<div id="t"><button>Save</button><button>Delete</button></div>',
    target: 'button:nth-child(2)',
    after: '<div id="t"><button>Save</button><button>Archive</button></div>',
    expect: null,
  },
  {
    name: 'list item removed, its siblings shift up',
    before: checkout(),
    target: '[data-testid="item-mug"] span:last-child',
    after: checkout({
      items: `
      <li data-testid="item-tee"><span>Logo tee</span><span>$24</span></li>
      <li data-testid="item-cap"><span>Dad cap</span><span>$22</span></li>`,
    }),
    expect: null,
  },
  {
    name: 'duplicate text: context picks the right card',
    before: addresses('shipping'),
    target: 'section:nth-child(2) button',
    after: addresses('shipping'),
    expect: 'section:nth-child(2) button',
  },
  {
    name: 'duplicate text, cards reordered: context beats position',
    before: addresses('shipping'),
    target: 'section:nth-child(2) button', // Billing "Edit"
    after: addresses('billing'),
    expect: 'section:nth-child(1) button', // Billing is now first
  },
  {
    name: 'tag changed (button → a), testId and text kept',
    before: checkout(),
    target: '[data-testid="checkout"]',
    after: checkout().replace(/<button([^>]*)>Place order<\/button>/, '<a href="/pay"$1>Place order</a>'),
    expect: '[data-testid="checkout"]',
  },
  {
    name: 'generated id changed above the element',
    before: '<div id=":r1:"><p>Intro</p><p>Details here</p></div>',
    target: 'p:nth-child(2)',
    after: '<div id=":r7:"><p>Intro</p><p>Details here</p></div>',
    expect: 'p:nth-child(2)',
  },
  {
    name: 'source location shifted lines in the same file',
    before: '<main><h1 data-pp-src="src/App.tsx:10:7">Title</h1><p data-pp-src="src/App.tsx:11:7">Hello there</p></main>',
    target: 'p',
    after: '<main><h1 data-pp-src="src/App.tsx:10:7">Title</h1><div><p data-pp-src="src/App.tsx:14:9">Hello there, friend</p></div></main>',
    expect: 'p',
  },
  {
    name: 'source pins a component whose text changed completely',
    before: '<main><p data-pp-src="src/Banner.tsx:4:5">Sale ends Friday</p><p data-pp-src="src/Footer.tsx:2:3">© Acme</p></main>',
    target: 'p:first-child',
    after: '<main><p data-pp-src="src/Banner.tsx:4:5">Free shipping this week</p><p data-pp-src="src/Footer.tsx:2:3">© Acme</p></main>',
    expect: 'p:first-child',
  },
];
