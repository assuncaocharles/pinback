import { resolvePRContextFromPage, type PRContext } from '@preview-pins/core';
import { styles } from './styles.js';

export const TAG_NAME = 'preview-pins';

export interface PreviewPinsConfig {
  owner?: string;
  repo?: string;
  prNumber?: number;
  commitSha?: string;
}

const template = `
<style>${styles}</style>
<div class="toolbar" role="toolbar" aria-label="Preview comments">
  <button type="button" part="toggle" data-action="toggle" aria-pressed="false">
    <span aria-hidden="true">&#x1F4CC;</span><span>Comment</span>
  </button>
  <button type="button" part="list" data-action="list" aria-label="Comments, 0">
    <span class="count" aria-hidden="true">0</span>
  </button>
  <span class="status" data-ref="status"></span>
</div>
<div class="sr-only" aria-live="polite" data-ref="live"></div>
`;

/**
 * `<preview-pins>`: the widget root. M0 renders the toolbar shell and
 * comment-mode toggle; pins, threads and the composer arrive in M1/M2.
 */
export class PreviewPinsElement extends HTMLElement {
  #config: PreviewPinsConfig = {};
  #commentMode = false;
  #root: ShadowRoot;
  #context: PRContext | null = null;

  constructor() {
    super();
    // Closed would not add security (host JS runs in the same realm and can
    // patch attachShadow); open keeps the widget testable and inspectable.
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = template;
    this.#root.addEventListener('click', this.#onClick);
  }

  get config(): PreviewPinsConfig {
    return this.#config;
  }

  set config(value: PreviewPinsConfig) {
    this.#config = { ...value };
    this.#resolveContext();
  }

  get context(): PRContext | null {
    return this.#context;
  }

  get commentMode(): boolean {
    return this.#commentMode;
  }

  set commentMode(on: boolean) {
    if (on === this.#commentMode) return;
    this.#commentMode = on;
    this.#el('[data-action="toggle"]').setAttribute('aria-pressed', String(on));
    this.#el('[data-ref="live"]').textContent = on ? 'Comment mode on' : 'Comment mode off';
    this.dispatchEvent(new CustomEvent('pp-comment-mode', { detail: { on }, bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    document.addEventListener('keydown', this.#onKeydown);
    this.#resolveContext();
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.#onKeydown);
  }

  #resolveContext(): void {
    if (!this.isConnected) return;
    this.#context = resolvePRContextFromPage(
      document,
      window.location,
      this.#config as Record<string, unknown>,
    );
    this.#el('[data-ref="status"]').textContent = this.#context
      ? `#${this.#context.prNumber}`
      : 'No PR context';
  }

  #el(selector: string): HTMLElement {
    const el = this.#root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`preview-pins: missing ${selector}`);
    return el;
  }

  #onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (target?.getAttribute('data-action') === 'toggle') this.commentMode = !this.commentMode;
  };

  #onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.#commentMode) this.commentMode = false;
  };
}
