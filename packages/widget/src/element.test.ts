// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { PreviewPinsElement, TAG_NAME } from './index.js';

const SHA = 'abc1234def5678abc1234def5678abc1234def56';

function mount(): PreviewPinsElement {
  const el = document.createElement(TAG_NAME);
  if (!(el instanceof PreviewPinsElement)) throw new Error('element not upgraded');
  document.body.append(el);
  return el;
}

function toggle(el: PreviewPinsElement): HTMLButtonElement {
  return el.shadowRoot!.querySelector('[data-action="toggle"]')!;
}

describe('<preview-pins>', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('registers the custom element on import', () => {
    expect(customElements.get(TAG_NAME)).toBe(PreviewPinsElement);
  });

  it('renders inside a shadow root', () => {
    const el = mount();
    expect(el.shadowRoot?.querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it('toggles comment mode and exposes aria-pressed', () => {
    const el = mount();
    toggle(el).click();
    expect(el.commentMode).toBe(true);
    expect(toggle(el).getAttribute('aria-pressed')).toBe('true');
  });

  it('exits comment mode on Escape', () => {
    const el = mount();
    el.commentMode = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.commentMode).toBe(false);
  });

  it('resolves PR context from the config object', () => {
    const el = mount();
    el.config = { owner: 'acme', repo: 'web', prNumber: 5, commitSha: SHA };
    expect(el.context).toEqual({ owner: 'acme', repo: 'web', prNumber: 5, commitSha: SHA });
  });

  it('prefers the meta tag over config', () => {
    document.head.innerHTML = `<meta name="preview-pins" content="owner=meta;repo=web;pr=9;sha=${SHA}">`;
    const el = mount();
    el.config = { owner: 'cfg', repo: 'cfg', prNumber: 1, commitSha: SHA };
    expect(el.context?.owner).toBe('meta');
    expect(el.context?.prNumber).toBe(9);
  });
});
