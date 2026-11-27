import {
  BackendError,
  GitHubBackend,
  buildThreads,
  normalisePath,
  resolvePRContextFromPage,
  threadsForPath,
  type Backend,
  type PRContext,
  type Thread,
} from '@preview-pins/core';
import { h } from './dom.js';
import { PinLayer } from './layer.js';
import { renderList } from './list-panel.js';
import { styles } from './styles.js';
import { ThreadDialog } from './thread-dialog.js';

export const TAG_NAME = 'preview-pins';

export interface PreviewPinsConfig {
  owner?: string;
  repo?: string;
  prNumber?: number;
  commitSha?: string;
  /** GitHub API base URL. Defaults to https://api.github.com. */
  apiBase?: string;
  /** How often to re-check for new comments while the tab is visible. Default 60 s. */
  pollIntervalMs?: number;
}

type Status =
  | { kind: 'no-context' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/**
 * `<preview-pins>`: the widget root. M1 is read-only: it fetches the PR's
 * comments, rebuilds threads from their metadata, anchors pins on the page
 * and shows threads. Writing arrives with sign-in in M2.
 */
export class PreviewPinsElement extends HTMLElement {
  #config: PreviewPinsConfig = {};
  #backend: Backend | null = null;
  #backendOverride: Backend | null = null;
  #context: PRContext | null = null;
  #threads: Thread[] = [];
  #status: Status = { kind: 'no-context' };
  #pathname = '';
  #commentMode = false;
  #pollTimer = 0;
  #abort: AbortController | null = null;

  readonly #root: ShadowRoot;
  readonly #toggle: HTMLButtonElement;
  readonly #listButton: HTMLButtonElement;
  readonly #count: HTMLSpanElement;
  readonly #statusEl: HTMLSpanElement;
  readonly #panel: HTMLDivElement;
  readonly #live: HTMLDivElement;
  readonly #layer: PinLayer;
  readonly #dialog: ThreadDialog;

  constructor() {
    super();
    // Closed would not add security (host JS runs in the same realm and can
    // patch attachShadow); open keeps the widget testable. See ADR 4.
    this.#root = this.attachShadow({ mode: 'open' });

    this.#toggle = h('button', { type: 'button', part: 'toggle', 'aria-pressed': 'false' },
      h('span', { 'aria-hidden': 'true' }, '📌'), h('span', {}, 'Comment'));
    this.#count = h('span', { class: 'count', 'aria-hidden': 'true' }, '0');
    this.#listButton = h('button', { type: 'button', part: 'list', 'aria-expanded': 'false', 'aria-controls': 'pp-list' },
      h('span', {}, 'Comments'), this.#count);
    this.#statusEl = h('span', { class: 'status', role: 'status' });
    this.#panel = h('div', { id: 'pp-list', class: 'panel', hidden: true });
    this.#live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    this.#layer = new PinLayer(this, {
      onOpen: (thread, invoker) => { this.#openThread(thread, invoker, false); },
      onAnchorsChange: () => { this.#renderChrome(); },
    });
    this.#dialog = new ThreadDialog(() => this.#listButton);

    this.#root.append(
      h('style', {}, styles),
      this.#layer.element,
      h('div', { class: 'dock' },
        this.#panel,
        h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Preview comments' },
          this.#toggle, this.#listButton, this.#statusEl)),
      this.#live,
      this.#dialog.element,
    );

    this.#toggle.addEventListener('click', () => { this.commentMode = !this.commentMode; });
    this.#listButton.addEventListener('click', () => { this.#setPanelOpen(!this.#panelOpen); });
  }

  get config(): PreviewPinsConfig {
    return this.#config;
  }

  set config(value: PreviewPinsConfig) {
    this.#config = { ...value };
    this.#backend = null;
    if (this.isConnected) this.#start();
  }

  /** Override the data source (tests, or a future GitLab backend). */
  set backend(value: Backend | null) {
    this.#backendOverride = value;
    if (this.isConnected) this.#start();
  }

  get context(): PRContext | null {
    return this.#context;
  }

  get threads(): readonly Thread[] {
    return this.#threads;
  }

  get commentMode(): boolean {
    return this.#commentMode;
  }

  set commentMode(on: boolean) {
    if (on === this.#commentMode) return;
    this.#commentMode = on;
    this.#toggle.setAttribute('aria-pressed', String(on));
    this.#announce(on ? 'Comment mode on' : 'Comment mode off');
    this.dispatchEvent(new CustomEvent('pp-comment-mode', { detail: { on }, bubbles: true, composed: true }));
  }

  /** Re-fetch comments now. 304s keep this cheap. */
  async refresh(): Promise<void> {
    if (!this.#context) return;
    this.#abort?.abort();
    const abort = (this.#abort = new AbortController());
    const backend =
      this.#backendOverride ??
      (this.#backend ??= new GitHubBackend(this.#config.apiBase ? { apiBase: this.#config.apiBase } : {}));
    if (this.#status.kind !== 'ready') this.#setStatus({ kind: 'loading' });
    try {
      const comments = await backend.listComments(this.#context, abort.signal);
      if (abort.signal.aborted) return;
      this.#threads = buildThreads(comments);
      this.#setStatus({ kind: 'ready' });
      this.#syncPage(true);
    } catch (err) {
      if (abort.signal.aborted) return;
      this.#setStatus({ kind: 'error', message: errorMessage(err) });
    }
  }

  connectedCallback(): void {
    document.addEventListener('keydown', this.#onKeydown);
    document.addEventListener('visibilitychange', this.#onVisibility);
    window.addEventListener('popstate', this.#onNavigate);
    this.#layer.connect();
    this.#start();
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.#onKeydown);
    document.removeEventListener('visibilitychange', this.#onVisibility);
    window.removeEventListener('popstate', this.#onNavigate);
    this.#layer.disconnect();
    this.#abort?.abort();
    clearInterval(this.#pollTimer);
  }

  #start(): void {
    this.#context = resolvePRContextFromPage(document, window.location, this.#config as Record<string, unknown>);
    clearInterval(this.#pollTimer);
    if (!this.#context) {
      this.#setStatus({ kind: 'no-context' });
      return;
    }
    void this.refresh();
    this.#pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
      this.#onNavigate();
    }, this.#config.pollIntervalMs ?? 60_000);
  }

  /** Pushes threads for the current path into the pin layer and redraws the dock. */
  #syncPage(force = false): void {
    const path = normalisePath(window.location.pathname);
    if (!force && path === this.#pathname) return;
    this.#pathname = path;
    const onPage = threadsForPath(this.#threads, path).filter((t) => t.state === 'open');
    this.#layer.setThreads(onPage);
    this.#renderChrome();
  }

  #renderChrome(): void {
    const open = threadsForPath(this.#threads, this.#pathname).filter((t) => t.state === 'open');
    this.#count.textContent = String(open.length);
    this.#listButton.setAttribute('aria-label', `Comments, ${open.length} open on this page`);
    if (this.#panelOpen) this.#renderPanel();
  }

  #renderPanel(): void {
    this.#panel.replaceChildren(
      renderList(
        { threads: this.#threads, pathname: this.#pathname, isAnchored: (id) => this.#layer.isAnchored(id) },
        { onSelect: (thread, outdated) => { this.#select(thread, outdated); } },
      ),
    );
  }

  get #panelOpen(): boolean {
    return !this.#panel.hidden;
  }

  #setPanelOpen(open: boolean): void {
    this.#panel.hidden = !open;
    this.#listButton.setAttribute('aria-expanded', String(open));
    if (open) {
      this.#renderPanel();
      this.#panel.querySelector<HTMLElement>('button')?.focus();
    }
  }

  #select(thread: Thread, outdated: boolean): void {
    this.#setPanelOpen(false);
    const pin = outdated ? null : this.#layer.reveal(thread.id);
    this.#openThread(thread, pin ?? this.#listButton, outdated);
  }

  #openThread(thread: Thread, invoker: HTMLElement, outdated: boolean): void {
    this.#dialog.open(thread, invoker, outdated);
  }

  #setStatus(status: Status): void {
    this.#status = status;
    const el = this.#statusEl;
    el.classList.toggle('error', status.kind === 'error');
    el.textContent =
      status.kind === 'no-context' ? 'No PR context'
      : status.kind === 'loading' ? 'Loading…'
      : status.kind === 'error' ? status.message
      : `PR #${this.#context?.prNumber ?? ''}`;
  }

  #announce(message: string): void {
    this.#live.textContent = message;
  }

  #onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#dialog.isOpen) return;
    if (this.#panelOpen) {
      this.#setPanelOpen(false);
      this.#listButton.focus();
    } else if (this.#commentMode) {
      this.commentMode = false;
    }
  };

  #onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  #onNavigate = (): void => {
    this.#syncPage();
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof BackendError) {
    switch (err.code) {
      case 'rate-limited':
        return err.resetAt
          ? `GitHub rate limit; retry after ${err.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : 'GitHub rate limit reached';
      case 'not-found':
        return 'PR not found (private repos need sign-in)';
      case 'network':
        return 'Offline or GitHub unreachable';
      case 'http':
        return 'Could not load comments';
    }
  }
  return 'Could not load comments';
}
