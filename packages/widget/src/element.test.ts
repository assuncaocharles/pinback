// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError, type Backend, type RawComment } from '@preview-pins/core';
import { rawPin } from '@preview-pins/core/testing';
import { PreviewPinsElement, TAG_NAME } from './index.js';

const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const CTX = { owner: 'acme', repo: 'web', prNumber: 5, commitSha: SHA };

const PAGE = `
  <main id="app">
    <h1>Checkout</h1>
    <button data-testid="checkout">Place order</button>
  </main>`;

function fakeBackend(comments: RawComment[] | Error): Backend & { calls: number } {
  return {
    kind: 'fake',
    calls: 0,
    listComments() {
      this.calls++;
      return comments instanceof Error ? Promise.reject(comments) : Promise.resolve(comments);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

async function mount(comments: RawComment[] | Error = []): Promise<PreviewPinsElement> {
  const el = document.createElement(TAG_NAME);
  if (!(el instanceof PreviewPinsElement)) throw new Error('element not upgraded');
  el.backend = fakeBackend(comments);
  el.config = CTX;
  document.body.append(el);
  await flush();
  return el;
}

const q = (el: PreviewPinsElement, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const qa = (el: PreviewPinsElement, sel: string) => Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(sel));

const pins = (el: PreviewPinsElement) => qa(el, '.pin');

describe('<preview-pins>', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = PAGE;
    // happy-dom has no layout; give every element a real-looking box.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 120, 40));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the custom element on import', () => {
    expect(customElements.get(TAG_NAME)).toBe(PreviewPinsElement);
  });

  it('disables comment mode when no auth worker is configured', async () => {
    const el = await mount();
    const toggle = q(el, '[part="toggle"]') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    el.commentMode = true;
    expect(el.commentMode).toBe(false);
  });

  it('prefers the meta tag over config', async () => {
    document.head.innerHTML = `<meta name="preview-pins" content="owner=meta;repo=web;pr=9;sha=${SHA}">`;
    const el = await mount();
    expect(el.context).toMatchObject({ owner: 'meta', prNumber: 9 });
  });

  it('shows "No PR context" without one', async () => {
    const el = document.createElement(TAG_NAME);
    if (!(el instanceof PreviewPinsElement)) throw new Error('element not upgraded');
    document.body.append(el);
    await flush();
    expect(q(el, '[role="status"]')!.textContent).toBe('No PR context');
  });

  it('renders a pin per open, anchored thread on this page', async () => {
    const el = await mount([
      rawPin(1, 'Make it bigger', { url: '/', anchor: { testId: 'checkout' } }),
      rawPin(2, 'Gone element', { url: '/', anchor: { testId: 'nope' } }),
      rawPin(3, 'Other page', { url: '/other', anchor: { testId: 'checkout' } }),
      rawPin(4, 'Done', { url: '/', anchor: { testId: 'checkout' } }, { login: 'alice' }),
      rawPin(5, '', { parent: 4, state: 'resolved' }, { login: 'alice' }),
    ]);
    expect(el.threads).toHaveLength(4);
    expect(pins(el).map((p) => p.textContent)).toEqual(['1', '2']);
    // #2 has no target: its marker stays hidden.
    await new Promise((r) => requestAnimationFrame(r));
    expect(pins(el).map((p) => p.hidden)).toEqual([false, true]);
    // Default rect (top-right corner of the target), centred on the 26px marker.
    expect(pins(el)[0]!.style.transform).toBe('translate(207px, 187px)');
    expect(q(el, '.count')!.textContent).toBe('2');
  });

  it('groups the list into on-page, outdated, other pages and resolved', async () => {
    const el = await mount([
      rawPin(1, 'Anchored', { url: '/', anchor: { testId: 'checkout' } }),
      rawPin(2, 'Outdated one', { url: '/', anchor: { testId: 'nope' }, sha: 'deadbee' }),
      rawPin(3, 'Elsewhere', { url: '/other' }),
      rawPin(4, 'Resolved one', { url: '/' }),
      rawPin(5, '', { parent: 4, state: 'resolved' }),
    ]);
    q(el, '[part="list"]')!.click();
    expect(q(el, '[part="list"]')!.getAttribute('aria-expanded')).toBe('true');
    const headings = qa(el, '.panel h3').map((h) => h.textContent);
    expect(headings).toEqual(['On this page', 'Outdated', 'Other pages', 'Resolved']);
    expect(q(el, '.panel')!.textContent).toContain('pinned at deadbee');
  });

  it('opens a thread from a pin and restores focus on close', async () => {
    const el = await mount([
      rawPin(1, 'Root text', { url: '/', anchor: { testId: 'checkout' } }),
      rawPin(2, 'A reply', { parent: 1 }, { login: 'bob' }),
    ]);
    const pin = pins(el)[0]!;
    pin.focus();
    pin.click();
    const dialog = el.shadowRoot!.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('h2')!.textContent).toBe('Comment 1');
    expect(dialog.querySelectorAll('.comments li')).toHaveLength(2);
    expect(dialog.textContent).toContain('A reply');
    (dialog.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    expect(dialog.open).toBe(false);
    expect(el.shadowRoot!.activeElement).toBe(pin);
  });

  it('sanitizes comment HTML before showing it', async () => {
    const evil = { ...rawPin(1, 'x', { url: '/', anchor: { testId: 'checkout' } }), bodyHtml: '<p>hi</p><img src=x onerror="window.pwned=1"><script>window.pwned=1</script>' };
    const el = await mount([evil]);
    pins(el)[0]!.click();
    const body = q(el, 'dialog .body')!;
    expect(body.innerHTML).toBe('<p>hi</p>');
  });

  it('opens outdated threads from the list with a badge', async () => {
    const el = await mount([rawPin(1, 'Lost', { url: '/', anchor: { testId: 'nope' }, sha: 'deadbee' })]);
    q(el, '[part="list"]')!.click();
    q(el, '.panel .item')!.click();
    const dialog = el.shadowRoot!.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Outdated · pinned at deadbee');
  });

  it('shows a readable error when rate limited', async () => {
    const el = await mount(new BackendError('limit', 'rate-limited'));
    expect(q(el, '[role="status"]')!.textContent).toBe('GitHub rate limit reached');
  });

  it('re-anchors when the page renders late', async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const el = await mount([rawPin(1, 'Late', { url: '/', anchor: { testId: 'checkout' } })]);
    expect(el.shadowRoot!.querySelector('.pin')!.hasAttribute('hidden')).toBe(true);
    document.getElementById('app')!.innerHTML = '<button data-testid="checkout">Place order</button>';
    await flush();
    await new Promise((r) => requestAnimationFrame(r));
    expect(pins(el)[0]!.hidden).toBe(false);
  });
});
