import type { Viewer } from '@assuncaocharles/pinback-core';
import { h } from './dom.js';
import { sanitize } from './sanitize.js';

export interface ComposerCallbacks {
  submit(text: string): Promise<void>;
  signIn(): void;
  renderPreview(text: string): Promise<string>;
}

let uid = 0;

/**
 * Text entry with Write/Preview tabs. Used by the new-comment dialog and the
 * reply box. Signed out, the submit button becomes "Sign in with GitHub" and
 * the draft is kept.
 */
export class Composer {
  readonly element: HTMLFormElement;
  readonly textarea: HTMLTextAreaElement;
  #submit: HTMLButtonElement;
  #error: HTMLParagraphElement;
  #preview: HTMLDivElement;
  #tabs: HTMLButtonElement[];
  #viewer: Viewer | null = null;
  #busy = false;
  readonly #cb: ComposerCallbacks;
  readonly #submitLabel: string;

  constructor(opts: { label: string; submitLabel: string; placeholder: string; extra?: HTMLElement[] }, cb: ComposerCallbacks) {
    this.#cb = cb;
    this.#submitLabel = opts.submitLabel;
    const id = `pp-c${++uid}`;
    this.textarea = h('textarea', { id: `${id}-text`, rows: 4, placeholder: opts.placeholder, 'aria-describedby': `${id}-hint` });
    const write = h('button', { type: 'button', role: 'tab', id: `${id}-tw`, 'aria-controls': `${id}-pw`, 'aria-selected': 'true' }, 'Write');
    const preview = h('button', { type: 'button', role: 'tab', id: `${id}-tp`, 'aria-controls': `${id}-pp`, 'aria-selected': 'false', tabindex: -1 }, 'Preview');
    this.#tabs = [write, preview];
    this.#preview = h('div', { class: 'body preview', id: `${id}-pp`, role: 'tabpanel', 'aria-labelledby': `${id}-tp`, hidden: true, tabindex: 0 });
    this.#error = h('p', { class: 'error', role: 'alert' });
    this.#submit = h('button', { type: 'submit', class: 'primary' }, opts.submitLabel);

    this.element = h(
      'form',
      { class: 'composer' },
      h('label', { for: this.textarea.id, class: 'sr-only' }, opts.label),
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': `${opts.label} mode` }, write, preview),
      h('div', { id: `${id}-pw`, role: 'tabpanel', 'aria-labelledby': write.id }, this.textarea),
      this.#preview,
      h('p', { id: `${id}-hint`, class: 'muted' }, 'Markdown supported. Ctrl+Enter to post.'),
      this.#error,
      h('div', { class: 'actions' }, ...(opts.extra ?? []), this.#submit),
    );

    write.addEventListener('click', () => { this.#select(0); });
    preview.addEventListener('click', () => { this.#select(1); });
    for (const tab of this.#tabs) tab.addEventListener('keydown', this.#onTabKey);
    this.textarea.addEventListener('input', () => { this.#sync(); });
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.element.requestSubmit();
      }
    });
    this.element.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.#onSubmit();
    });
    this.#sync();
  }

  setViewer(viewer: Viewer | null): void {
    this.#viewer = viewer;
    this.#sync();
  }

  reset(): void {
    this.textarea.value = '';
    this.#error.textContent = '';
    this.#select(0);
    this.#sync();
  }

  #sync(): void {
    const signedIn = !!this.#viewer;
    this.#submit.textContent = signedIn ? (this.#busy ? 'Posting…' : this.#submitLabel) : 'Sign in with GitHub';
    this.#submit.disabled = this.#busy || (signedIn && !this.textarea.value.trim());
  }

  async #onSubmit(): Promise<void> {
    if (!this.#viewer) {
      this.#cb.signIn();
      return;
    }
    const text = this.textarea.value.trim();
    if (!text || this.#busy) return;
    this.#busy = true;
    this.#error.textContent = '';
    this.#sync();
    try {
      await this.#cb.submit(text);
      this.reset();
    } catch (err) {
      this.#error.textContent = err instanceof Error ? err.message : 'Could not post the comment.';
    } finally {
      this.#busy = false;
      this.#sync();
    }
  }

  #select(index: 0 | 1): void {
    this.#tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    (this.textarea.parentElement as HTMLElement).hidden = index !== 0;
    this.#preview.hidden = index !== 1;
    if (index === 1) void this.#renderPreview();
  }

  async #renderPreview(): Promise<void> {
    const text = this.textarea.value.trim();
    if (!text) {
      this.#preview.replaceChildren(h('p', { class: 'muted' }, 'Nothing to preview.'));
      return;
    }
    if (!this.#viewer) {
      this.#preview.replaceChildren(h('p', { class: 'muted' }, 'Sign in to preview markdown.'));
      return;
    }
    this.#preview.replaceChildren(h('p', { class: 'muted' }, 'Rendering…'));
    try {
      this.#preview.replaceChildren(sanitize(await this.#cb.renderPreview(text)));
    } catch {
      this.#preview.replaceChildren(h('p', { class: 'muted' }, 'Preview unavailable.'));
    }
  }

  #onTabKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const [write, preview] = this.#tabs;
    const next = write?.getAttribute('aria-selected') === 'true' ? 1 : 0;
    this.#select(next);
    (next === 1 ? preview : write)?.focus();
  };
}
