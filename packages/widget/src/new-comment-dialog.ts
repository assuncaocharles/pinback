import type { Viewer } from '@preview-pins/core';
import { Composer, type ComposerCallbacks } from './composer.js';
import { h } from './dom.js';

/** Modal dialog for a new pin: target description + composer. */
export class NewCommentDialog {
  readonly element: HTMLDialogElement;
  readonly #composer: Composer;
  readonly #target: HTMLParagraphElement;
  #restore: HTMLElement | null = null;
  #onClose: (() => void) | null = null;

  constructor(cb: ComposerCallbacks) {
    this.#target = h('p', { class: 'muted target' });
    this.#composer = new Composer(
      { label: 'Comment', submitLabel: 'Comment', placeholder: 'Leave a comment…' },
      {
        ...cb,
        submit: async (text) => {
          await cb.submit(text);
          this.close();
        },
      },
    );
    const close = h('button', { type: 'button', class: 'icon', 'aria-label': 'Cancel' }, '×');
    close.addEventListener('click', () => { this.close(); });
    this.element = h(
      'dialog',
      { class: 'thread composer-dialog', 'aria-labelledby': 'pp-new-title' },
      h('header', {}, h('h2', { id: 'pp-new-title' }, 'New comment'), close),
      h('div', { class: 'reply' }, this.#target, this.#composer.element),
    );
    this.element.addEventListener('close', () => {
      this.#restore?.focus();
      this.#restore = null;
      this.#onClose?.();
      this.#onClose = null;
    });
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  open(targetDescription: string, restoreFocus: HTMLElement | null, onClose: () => void): void {
    this.#target.textContent = `On ${targetDescription}`;
    this.#restore = restoreFocus;
    this.#onClose = onClose;
    if (!this.element.open) this.element.showModal();
    this.#composer.textarea.focus();
  }

  setViewer(viewer: Viewer | null): void {
    this.#composer.setViewer(viewer);
  }

  close(): void {
    if (this.element.open) this.element.close();
  }
}
