import {
  BackendError,
  GitHubBackend,
  buildThreads,
  describeElement,
  normalisePath,
  resolveAuthOrigin,
  resolvePRContextFromPage,
  threadsForPath,
  type Backend,
  type PinMetadata,
  type PRContext,
  type RawComment,
  type Thread,
  type ThreadState,
  type Viewer,
} from '@preview-pins/core';
import { h } from './dom.js';
import { FrameBackend, FrameError, createAuthFrame, type AuthFrame } from './frame-client.js';
import { PinLayer } from './layer.js';
import { renderList } from './list-panel.js';
import { NewCommentDialog } from './new-comment-dialog.js';
import { Picker, describeTarget } from './picker.js';
import { styles } from './styles.js';
import { ThreadDialog } from './thread-dialog.js';

export const TAG_NAME = 'preview-pins';

export interface PreviewPinsConfig {
  owner?: string;
  repo?: string;
  prNumber?: number;
  commitSha?: string;
  /** GitHub API base URL for anonymous reads. Defaults to https://api.github.com. */
  apiBase?: string;
  /** Auth worker origin. The meta tag's `auth=` wins over this. */
  authOrigin?: string;
  /** How often to re-check for new comments while the tab is visible. Default 60 s. */
  pollIntervalMs?: number;
}

type Status =
  | { kind: 'no-context' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const AUTH_HASH = '#pp_auth=';
const POPUP_NAME = 'pp-auth';

/**
 * `<preview-pins>`: the widget root.
 * M1: read pins and threads. M2: sign in through the auth frame, create
 * pins, reply, resolve/reopen. The token never enters this page (ADR 7).
 */
export class PreviewPinsElement extends HTMLElement {
  #config: PreviewPinsConfig = {};
  #anonBackend: Backend | null = null;
  #backendOverride: Backend | null = null;
  #frame: AuthFrame | null = null;
  #frameBackend: FrameBackend | null = null;
  #viewer: Viewer | null = null;
  #canMaintain = false;
  #context: PRContext | null = null;
  #comments: RawComment[] = [];
  /** Comments we posted that the server's list may not include yet (in-flight or cached reads). */
  #local = new Map<string, RawComment>();
  #threads: Thread[] = [];
  #status: Status = { kind: 'no-context' };
  #pathname = '';
  #commentMode = false;
  #pollTimer = 0;
  #abort: AbortController | null = null;
  #pendingBlob: string | null = null;
  #pendingMeta: PinMetadata | null = null;

  readonly #root: ShadowRoot;
  readonly #toggle: HTMLButtonElement;
  readonly #listButton: HTMLButtonElement;
  readonly #count: HTMLSpanElement;
  readonly #statusEl: HTMLSpanElement;
  readonly #panel: HTMLDivElement;
  readonly #live: HTMLDivElement;
  readonly #layer: PinLayer;
  readonly #picker: Picker;
  readonly #dialog: ThreadDialog;
  readonly #newDialog: NewCommentDialog;

  constructor() {
    super();
    // Closed would not add security (host JS runs in the same realm and can
    // patch attachShadow); open keeps the widget testable. See ADR 4.
    this.#root = this.attachShadow({ mode: 'open' });

    this.#toggle = h('button', { type: 'button', part: 'toggle', 'aria-pressed': 'false' },
      h('span', { 'aria-hidden': 'true' }, '📌'), h('span', {}, 'Comment'));
    // Visible text is the start of the accessible name ("Comments 2 open on
    // this page"), so speech-input users can say what they see (WCAG 2.5.3).
    this.#count = h('span', { class: 'count' }, '0');
    this.#listButton = h('button', { type: 'button', part: 'list', 'aria-expanded': 'false', 'aria-controls': 'pp-list' },
      h('span', {}, 'Comments'), ' ', this.#count, h('span', { class: 'sr-only' }, ' open on this page'));
    this.#statusEl = h('span', { class: 'status', role: 'status' });
    this.#panel = h('div', { id: 'pp-list', class: 'panel', hidden: true });
    this.#live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    this.#layer = new PinLayer(this, {
      onOpen: (thread, invoker) => { this.#dialog.open(thread, invoker, false); },
      onAnchorsChange: () => { this.#renderChrome(); },
    });
    this.#picker = new Picker(this, {
      onPick: (el, point) => { this.#onPick(el, point); },
      announce: (msg) => { this.#announce(msg); },
    });
    const writing = {
      reply: (thread: Thread, text: string) => this.#reply(thread, text),
      setState: (thread: Thread, state: ThreadState) => this.#setThreadState(thread, state),
      signIn: () => { this.signIn(); },
      renderPreview: (text: string) => this.#renderPreview(text),
      canResolve: (thread: Thread) =>
        !!this.#viewer && (this.#viewer.login === thread.root.author.login || this.#canMaintain),
    };
    this.#dialog = new ThreadDialog({
      fallbackFocus: () => this.#listButton,
      // The writing callbacks check for a frame at call time; the composer is
      // hidden via setViewer when there is no auth worker.
      writing,
    });
    this.#newDialog = new NewCommentDialog({
      submit: (text) => this.#createPin(text),
      signIn: () => { this.signIn(); },
      renderPreview: (text) => this.#renderPreview(text),
    });

    this.#root.append(
      h('style', {}, styles),
      this.#layer.element,
      this.#picker.outline,
      h('div', { class: 'dock' },
        this.#panel,
        h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Preview comments' },
          this.#toggle, this.#listButton, this.#statusEl)),
      this.#live,
      this.#dialog.element,
      this.#newDialog.element,
    );

    this.#toggle.addEventListener('click', () => { this.commentMode = !this.commentMode; });
    this.#listButton.addEventListener('click', () => { this.#setPanelOpen(!this.#panelOpen); });
  }

  // ---- public API --------------------------------------------------------

  get config(): PreviewPinsConfig {
    return this.#config;
  }

  set config(value: PreviewPinsConfig) {
    this.#config = { ...value };
    this.#anonBackend = null;
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

  get viewer(): Viewer | null {
    return this.#viewer;
  }

  get commentMode(): boolean {
    return this.#commentMode;
  }

  set commentMode(on: boolean) {
    if (on === this.#commentMode) return;
    if (on && (!this.#frame || !this.#context)) return;
    this.#commentMode = on;
    this.#toggle.setAttribute('aria-pressed', String(on));
    if (on) {
      this.#setPanelOpen(false);
      this.#picker.enable();
    } else {
      this.#picker.disable();
      this.#announce('Comment mode off');
    }
    this.dispatchEvent(new CustomEvent('pp-comment-mode', { detail: { on }, bubbles: true, composed: true }));
  }

  /**
   * Opens the GitHub sign-in popup. Must run inside a user gesture. Falls
   * back to a same-tab redirect if the popup is blocked.
   */
  signIn(): void {
    if (!this.#frame) return;
    const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const url = this.#frame.signInUrl(returnUrl);
    const popup = window.open(url, POPUP_NAME, 'popup,width=640,height=760');
    if (!popup) window.location.assign(url);
  }

  async signOut(): Promise<void> {
    await this.#frame?.call('signOut', {});
  }

  /** Re-fetch comments now. 304s keep this cheap. */
  async refresh(): Promise<void> {
    if (!this.#context) return;
    this.#abort?.abort();
    const abort = (this.#abort = new AbortController());
    if (this.#status.kind !== 'ready') this.#setStatus({ kind: 'loading' });
    try {
      const comments = await this.#readBackend().listComments(this.#context, abort.signal);
      if (abort.signal.aborted) return;
      this.#setComments(comments);
      this.#setStatus({ kind: 'ready' });
    } catch (err) {
      if (abort.signal.aborted) return;
      this.#setStatus({ kind: 'error', message: errorMessage(err, !!this.#frame && !this.#viewer) });
    }
  }

  // ---- lifecycle -----------------------------------------------------------

  connectedCallback(): void {
    this.#takeAuthHash();
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
    this.#picker.disable();
    this.#abort?.abort();
    clearInterval(this.#pollTimer);
    this.#frame?.destroy();
    this.#frame = null;
    this.#frameBackend = null;
  }

  #start(): void {
    this.#context = resolvePRContextFromPage(document, window.location, this.#config as Record<string, unknown>);
    this.#setupFrame(resolveAuthOrigin(document, this.#config));
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

  #setupFrame(origin: string | null): void {
    if (this.#frame?.origin === origin) return;
    this.#frame?.destroy();
    this.#frame = null;
    this.#frameBackend = null;
    this.#setViewer(null);
    this.#toggle.disabled = !origin || !this.#context;
    this.#dialog.setWritable(!!origin);
    this.#toggle.title = origin ? '' : 'Commenting is not configured for this preview';
    if (!origin) return;

    const frame = createAuthFrame(origin, { onAuthChange: (viewer) => { this.#setViewer(viewer); } });
    this.#frame = frame;
    this.#root.append(frame.iframe);
    frame
      .ready()
      .then(async () => {
        if (this.#frame !== frame) return;
        this.#setViewer(frame.viewer);
        if (this.#pendingBlob) {
          const blob = this.#pendingBlob;
          this.#pendingBlob = null;
          await frame.redeem(blob);
          // The redirect fallback ran inside our own sign-in popup: we're done.
          if (window.name === POPUP_NAME && window.opener) window.close();
        }
      })
      .catch(() => {
        if (this.#frame === frame) this.#announce('Sign-in is unavailable right now.');
      });
  }

  /** Redirect-fallback sign-in lands here with #pp_auth=<sealed blob>. */
  #takeAuthHash(): void {
    if (!window.location.hash.startsWith(AUTH_HASH)) return;
    this.#pendingBlob = window.location.hash.slice(AUTH_HASH.length);
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
  }

  #setViewer(viewer: Viewer | null): void {
    const changed = viewer?.login !== this.#viewer?.login;
    this.#viewer = viewer;
    this.#dialog.setViewer(viewer);
    this.#newDialog.setViewer(viewer);
    if (!changed) return;
    this.#canMaintain = false;
    this.#frameBackend = viewer && this.#frame ? new FrameBackend(this.#frame) : null;
    if (viewer) {
      this.#announce(`Signed in as ${viewer.login}`);
      const ctx = this.#context;
      if (ctx && this.#frame) {
        this.#frame
          .call('canMaintain', { ctx })
          .then((can) => {
            this.#canMaintain = can;
            this.#dialog.setViewer(viewer);
          })
          .catch(() => undefined);
      }
    }
    this.#renderChrome();
    void this.refresh();
  }

  #readBackend(): Backend {
    return (
      this.#backendOverride ??
      this.#frameBackend ??
      (this.#anonBackend ??= new GitHubBackend(this.#config.apiBase ? { apiBase: this.#config.apiBase } : {}))
    );
  }

  // ---- data ----------------------------------------------------------------

  #setComments(server: RawComment[]): void {
    const seen = new Set(server.map((c) => c.id));
    for (const id of this.#local.keys()) if (seen.has(id)) this.#local.delete(id);
    const comments = [...server, ...this.#local.values()];
    this.#comments = comments;
    this.#threads = buildThreads(comments);
    this.#syncPage(true);
    const openId = this.#dialog.threadId;
    const open = openId ? this.#threads.find((t) => t.id === openId) : undefined;
    if (open) this.#dialog.update(open);
  }

  #addComment(comment: RawComment): void {
    if (this.#comments.some((c) => c.id === comment.id)) return;
    this.#local.set(comment.id, comment);
    this.#setComments(this.#comments.filter((c) => !this.#local.has(c.id)));
  }

  async #post(text: string, meta: PinMetadata, parentKind?: RawComment['kind']): Promise<RawComment> {
    const frame = this.#frame;
    const ctx = this.#context;
    if (!frame || !ctx) throw new Error('Commenting is not configured for this preview.');
    try {
      const previewUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
      const created = await frame.call('createComment', { ctx, text, meta, previewUrl, ...(parentKind ? { parentKind } : {}) });
      this.#addComment(created);
      return created;
    } catch (err) {
      throw new Error(writeErrorMessage(err), { cause: err });
    }
  }

  #baseMeta(url: string, parent: number | null): PinMetadata {
    return {
      anchor: {},
      viewport: { w: window.innerWidth, h: window.innerHeight },
      url: normalisePath(url),
      sha: this.#context?.commitSha ?? '',
      parent,
    };
  }

  #onPick(el: Element, point: { x: number; y: number } | undefined): void {
    if (this.#newDialog.isOpen) return;
    const meta = this.#baseMeta(window.location.pathname, null);
    meta.anchor = describeElement(el, point);
    this.#pendingMeta = meta;
    this.commentMode = false;
    this.#newDialog.open(describeTarget(el), this.#toggle, () => {
      this.#pendingMeta = null;
    });
  }

  async #createPin(text: string): Promise<void> {
    const meta = this.#pendingMeta;
    if (!meta) return;
    await this.#post(text, meta);
    this.#announce('Comment posted');
  }

  async #reply(thread: Thread, text: string): Promise<void> {
    await this.#post(text, this.#baseMeta(thread.root.meta.url, Number(thread.id)), thread.root.kind);
    this.#announce('Reply posted');
  }

  async #setThreadState(thread: Thread, state: ThreadState): Promise<void> {
    const meta = this.#baseMeta(thread.root.meta.url, Number(thread.id));
    meta.state = state;
    await this.#post('', meta, thread.root.kind);
    this.#announce(state === 'resolved' ? 'Thread resolved' : 'Thread reopened');
  }

  async #renderPreview(text: string): Promise<string> {
    const ctx = this.#context;
    if (!this.#frame || !ctx) throw new Error('unavailable');
    return this.#frame.call('renderMarkdown', { ctx, text });
  }

  // ---- rendering -----------------------------------------------------------

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
    if (this.#panelOpen) this.#renderPanel();
  }

  #renderPanel(): void {
    const footer = this.#accountFooter();
    this.#panel.replaceChildren(
      renderList(
        { threads: this.#threads, pathname: this.#pathname, isAnchored: (id) => this.#layer.isAnchored(id) },
        { onSelect: (thread, outdated) => { this.#select(thread, outdated); } },
      ),
      ...(footer ? [footer] : []),
    );
  }

  #accountFooter(): HTMLElement | null {
    if (!this.#frame) return null;
    if (this.#viewer) {
      const out = h('button', { type: 'button', class: 'link' }, 'Sign out');
      out.addEventListener('click', () => { void this.signOut(); });
      return h('div', { class: 'account' }, h('span', { class: 'muted' }, `Signed in as ${this.#viewer.login}`), out);
    }
    const btn = h('button', { type: 'button', class: 'secondary' }, 'Sign in with GitHub');
    btn.addEventListener('click', () => { this.signIn(); });
    return h('div', { class: 'account' }, h('span', { class: 'muted' }, 'Sign in to comment'), btn);
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
    this.#dialog.open(thread, pin ?? this.#listButton, outdated);
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

  // ---- events --------------------------------------------------------------

  #onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#dialog.isOpen || this.#newDialog.isOpen) return;
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

function errorMessage(err: unknown, canSignIn: boolean): string {
  if (err instanceof BackendError || err instanceof FrameError) {
    switch (err.code) {
      case 'rate-limited':
        return err instanceof BackendError && err.resetAt
          ? `GitHub rate limit; retry after ${err.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : 'GitHub rate limit reached';
      case 'not-found':
        return canSignIn ? 'PR not found. Sign in for private repos' : 'PR not found';
      case 'network':
        return 'Offline or GitHub unreachable';
      default:
        return 'Could not load comments';
    }
  }
  return 'Could not load comments';
}

function writeErrorMessage(err: unknown): string {
  if (err instanceof FrameError) {
    switch (err.code) {
      case 'unauthenticated':
        return 'Your GitHub session expired. Sign in again.';
      case 'forbidden':
        return 'You do not have permission to comment on this PR.';
      case 'rate-limited':
        return 'GitHub rate limit reached. Try again shortly.';
      case 'network':
      case 'timeout':
        return 'Could not reach GitHub. Check your connection and try again.';
      default:
        return err.message || 'Could not post the comment.';
    }
  }
  return err instanceof Error ? err.message : 'Could not post the comment.';
}
