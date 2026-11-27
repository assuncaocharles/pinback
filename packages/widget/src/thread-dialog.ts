import type { PinComment, Thread } from '@preview-pins/core';
import { h, relativeTime } from './dom.js';
import { sanitize, stripFooter } from './sanitize.js';

/**
 * Thread view: a native modal <dialog>, which gives us the WAI-ARIA dialog
 * pattern (focus containment, inert background, Escape to close) and renders
 * in the top layer above any host z-index. We add focus restoration and
 * positioning next to the pin.
 */
export class ThreadDialog {
  readonly element: HTMLDialogElement;
  #invoker: HTMLElement | null = null;
  #fallbackFocus: () => HTMLElement | null;

  constructor(fallbackFocus: () => HTMLElement | null) {
    this.#fallbackFocus = fallbackFocus;
    this.element = h('dialog', { class: 'thread', 'aria-labelledby': 'pp-thread-title' });
    this.element.addEventListener('close', this.#restoreFocus);
    // Click on the backdrop (the dialog element itself, outside its box) closes it.
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.close();
    });
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  open(thread: Thread, invoker: HTMLElement, outdated: boolean): void {
    this.#invoker = invoker;
    this.element.replaceChildren(this.#render(thread, outdated));
    if (!this.element.open) this.element.showModal();
    this.#position(invoker);
    this.element.querySelector<HTMLElement>('#pp-thread-title')?.focus();
  }

  close(): void {
    if (this.element.open) this.element.close();
  }

  #restoreFocus = (): void => {
    const target = this.#invoker?.isConnected && !this.#invoker.hidden ? this.#invoker : this.#fallbackFocus();
    this.#invoker = null;
    target?.focus();
  };

  #position(invoker: HTMLElement): void {
    const d = this.element;
    if (window.innerWidth < 560) {
      d.style.removeProperty('left');
      d.style.removeProperty('top');
      d.style.removeProperty('transform');
      return;
    }
    const pin = invoker.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = d;
    const gap = 8;
    let left = pin.right + gap;
    if (left + w > window.innerWidth - 16) left = pin.left - gap - w;
    left = Math.max(16, Math.min(left, window.innerWidth - w - 16));
    const top = Math.max(16, Math.min(pin.top, window.innerHeight - h - 16));
    d.style.transform = 'none';
    d.style.left = `${Math.round(left)}px`;
    d.style.top = `${Math.round(top)}px`;
  }

  #render(thread: Thread, outdated: boolean): DocumentFragment {
    const frag = document.createDocumentFragment();
    const close = h('button', { type: 'button', class: 'icon', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => {
      this.close();
    });

    const badges = h('div', { class: 'badges' });
    if (thread.state === 'resolved') badges.append(h('span', { class: 'badge' }, 'Resolved'));
    if (outdated)
      badges.append(h('span', { class: 'badge warn' }, `Outdated · pinned at ${thread.root.meta.sha.slice(0, 7)}`));

    frag.append(
      h(
        'header',
        {},
        h('h2', { id: 'pp-thread-title', tabindex: -1 }, `Comment ${thread.number}`),
        close,
      ),
      badges,
      h('ol', { class: 'comments' }, ...[thread.root, ...thread.replies].map(renderComment)),
      h(
        'footer',
        {},
        h('a', { href: thread.root.htmlUrl, target: '_blank', rel: 'noopener noreferrer' }, 'View on GitHub'),
        h('span', { class: 'muted' }, 'Replying arrives with sign-in'),
      ),
    );
    return frag;
  }
}

function renderComment(c: PinComment): HTMLLIElement {
  const body = h('div', { class: 'body' });
  if (c.bodyHtml) body.append(stripFooter(sanitize(c.bodyHtml)));
  else body.append(h('p', {}, c.text));
  return h(
    'li',
    {},
    h(
      'div',
      { class: 'meta' },
      c.author.avatarUrl
        ? h('img', { class: 'avatar', src: `${c.author.avatarUrl}${c.author.avatarUrl.includes('?') ? '&' : '?'}s=40`, alt: '', width: 20, height: 20, referrerpolicy: 'no-referrer' })
        : null,
      h('strong', {}, c.author.login),
      h('time', { datetime: c.createdAt, title: new Date(c.createdAt).toLocaleString() }, relativeTime(c.createdAt)),
    ),
    body,
  );
}
