import type { PinComment, Thread, ThreadState, Viewer } from '@preview-pins/core';
import { Composer } from './composer.js';
import { h, relativeTime } from './dom.js';
import { sanitize, stripFooter } from './sanitize.js';

export interface ThreadDialogCallbacks {
  /** Focus target when the invoker is gone. */
  fallbackFocus(): HTMLElement | null;
  /** Null when writing isn't configured (no auth worker). */
  writing: {
    reply(thread: Thread, text: string): Promise<void>;
    setState(thread: Thread, state: ThreadState): Promise<void>;
    signIn(): void;
    renderPreview(text: string): Promise<string>;
    canResolve(thread: Thread): boolean;
  } | null;
}

/**
 * Thread view: a native modal <dialog>, which gives us the WAI-ARIA dialog
 * pattern (focus containment, inert background, Escape to close) and renders
 * in the top layer above any host z-index. We add focus restoration,
 * positioning next to the pin, and (M2) a reply box.
 */
export class ThreadDialog {
  readonly element: HTMLDialogElement;
  #invoker: HTMLElement | null = null;
  #thread: Thread | null = null;
  #outdated = false;
  #viewer: Viewer | null = null;
  #writable = false;
  readonly #composer: Composer | null;
  readonly #stateButton: HTMLButtonElement;
  readonly #cb: ThreadDialogCallbacks;

  constructor(cb: ThreadDialogCallbacks) {
    this.#cb = cb;
    this.element = h('dialog', { class: 'thread', 'aria-labelledby': 'pp-thread-title' });
    this.element.addEventListener('close', this.#restoreFocus);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.close();
    });
    this.#stateButton = h('button', { type: 'button', class: 'secondary' });
    this.#stateButton.addEventListener('click', () => { void this.#toggleState(); });
    const w = cb.writing;
    this.#composer = w
      ? new Composer(
          { label: 'Reply', submitLabel: 'Reply', placeholder: 'Reply…', extra: [this.#stateButton] },
          {
            submit: (text) => (this.#thread ? w.reply(this.#thread, text) : Promise.resolve()),
            signIn: () => { w.signIn(); },
            renderPreview: (text) => w.renderPreview(text),
          },
        )
      : null;
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  get threadId(): string | null {
    return this.element.open ? (this.#thread?.id ?? null) : null;
  }

  open(thread: Thread, invoker: HTMLElement, outdated: boolean): void {
    this.#invoker = invoker;
    if (this.#thread?.id !== thread.id) this.#composer?.reset();
    this.#thread = thread;
    this.#outdated = outdated;
    this.#render();
    if (!this.element.open) this.element.showModal();
    this.#position(invoker);
    this.element.querySelector<HTMLElement>('#pp-thread-title')?.focus();
  }

  /** Re-render with fresh data (new replies, state change) without losing the draft. */
  update(thread: Thread): void {
    if (!this.element.open || this.#thread?.id !== thread.id) return;
    this.#thread = thread;
    this.#render();
  }

  setViewer(viewer: Viewer | null): void {
    this.#viewer = viewer;
    this.#composer?.setViewer(viewer);
    if (this.element.open) this.#render();
  }

  /** Whether an auth worker is configured; without one there's no reply box. */
  setWritable(writable: boolean): void {
    this.#writable = writable;
    if (this.element.open) this.#render();
  }

  close(): void {
    if (this.element.open) this.element.close();
  }

  #restoreFocus = (): void => {
    const target = this.#invoker?.isConnected && !this.#invoker.hidden ? this.#invoker : this.#cb.fallbackFocus();
    this.#invoker = null;
    target?.focus();
  };

  async #toggleState(): Promise<void> {
    const w = this.#cb.writing;
    if (!w || !this.#thread) return;
    this.#stateButton.disabled = true;
    try {
      await w.setState(this.#thread, this.#thread.state === 'open' ? 'resolved' : 'open');
    } finally {
      this.#stateButton.disabled = false;
    }
  }

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

  #render(): void {
    const thread = this.#thread;
    if (!thread) return;
    const close = h('button', { type: 'button', class: 'icon', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => { this.close(); });

    const badges = h('div', { class: 'badges' });
    if (thread.state === 'resolved') {
      badges.append(h('span', { class: 'badge' }, thread.stateChangedBy ? `Resolved by ${thread.stateChangedBy}` : 'Resolved'));
    }
    if (this.#outdated) badges.append(h('span', { class: 'badge warn' }, `Outdated · pinned at ${thread.root.meta.sha.slice(0, 7)}`));

    const w = this.#writable ? this.#cb.writing : null;
    const composer = w ? this.#composer : null;
    const canResolve = !!w && !!this.#viewer && w.canResolve(thread);
    this.#stateButton.hidden = !canResolve;
    this.#stateButton.textContent = thread.state === 'open' ? 'Resolve' : 'Reopen';

    const parts: (HTMLElement | null)[] = [
      h('header', {}, h('h2', { id: 'pp-thread-title', tabindex: -1 }, `Comment ${thread.number}`), close),
      badges,
      h('ol', { class: 'comments' }, ...[thread.root, ...thread.replies].map(renderComment)),
      composer ? h('div', { class: 'reply' }, composer.element) : null,
      h(
        'footer',
        {},
        h('a', { href: thread.root.htmlUrl, target: '_blank', rel: 'noopener noreferrer' }, 'View on GitHub'),
        composer ? null : h('span', { class: 'muted' }, 'Commenting is not configured for this preview'),
      ),
    ];
    this.element.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }
}

function renderComment(c: PinComment): HTMLLIElement {
  const body = h('div', { class: 'body' });
  if (c.bodyHtml) body.append(stripFooter(sanitize(c.bodyHtml)));
  else body.append(h('p', {}, c.text.replace(/<sub>[\s\S]*?<\/sub>/g, '').trim()));
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
