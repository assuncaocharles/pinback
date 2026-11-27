import {
  RPC_VERSION,
  isRpcEvent,
  isRpcResponse,
  isSealedSignIn,
  type Backend,
  type PRContext,
  type RawComment,
  type RpcErrorCode,
  type RpcMethod,
  type RpcMethods,
  type Viewer,
} from '@preview-pins/core';

export class FrameError extends Error {
  constructor(
    readonly code: RpcErrorCode | 'timeout' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'FrameError';
  }
}

export interface FrameClientEvents {
  onAuthChange(viewer: Viewer | null): void;
}

const TIMEOUT_MS = 20_000;

/** What the widget needs from the auth frame. FrameClient is the real one; tests inject fakes. */
export interface AuthFrame {
  readonly origin: string;
  readonly iframe: HTMLElement;
  readonly viewer: Viewer | null;
  ready(): Promise<void>;
  signInUrl(returnUrl: string): string;
  call<M extends RpcMethod>(method: M, params: RpcMethods[M][0]): Promise<RpcMethods[M][1]>;
  redeem(blob: string): Promise<Viewer | null>;
  destroy(): void;
}

type FrameFactory = (origin: string, events: FrameClientEvents) => AuthFrame;
let factory: FrameFactory = (origin, events) => new FrameClient(origin, events);

export function createAuthFrame(origin: string, events: FrameClientEvents): AuthFrame {
  return factory(origin, events);
}

/** Test seam. Not exported from the package entry. */
export function setAuthFrameFactory(f: FrameFactory | null): void {
  factory = f ?? ((origin, events) => new FrameClient(origin, events));
}

/**
 * The widget's side of the auth frame. Creates a hidden iframe on the auth
 * worker's origin and talks to it over postMessage. Every incoming message
 * is checked for origin AND source before it's read. The token stays in the
 * frame; this class only ever sees results.
 */
export class FrameClient implements AuthFrame {
  readonly iframe: HTMLIFrameElement;
  readonly origin: string;
  #ready: Promise<void>;
  #nextId = 1;
  #pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: number }>();
  #viewer: Viewer | null = null;
  #challenge = '';
  readonly #events: FrameClientEvents;

  constructor(origin: string, events: FrameClientEvents) {
    this.origin = origin;
    this.#events = events;
    this.iframe = document.createElement('iframe');
    this.iframe.src = `${origin}/frame`;
    this.iframe.title = 'preview-pins sign-in';
    this.iframe.setAttribute('aria-hidden', 'true');
    this.iframe.tabIndex = -1;
    this.iframe.className = 'auth-frame';
    window.addEventListener('message', this.#onMessage);
    this.#ready = new Promise<void>((resolve, reject) => {
      this.iframe.addEventListener(
        'load',
        () => {
          this.#rawCall('hello', {})
            .then(({ viewer, challenge }) => {
              this.#viewer = viewer;
              this.#challenge = challenge;
              resolve();
            })
            .catch(reject);
        },
        { once: true },
      );
      this.iframe.addEventListener('error', () => { reject(new FrameError('unavailable', 'Auth frame failed to load')); }, { once: true });
    });
    // Avoid unhandled rejection noise; callers see the error via ready().
    this.#ready.catch(() => undefined);
  }

  ready(): Promise<void> {
    return this.#ready;
  }

  get viewer(): Viewer | null {
    return this.#viewer;
  }

  /** URL to open in the sign-in popup. */
  signInUrl(returnUrl: string): string {
    const u = new URL(`${this.origin}/auth/start`);
    u.searchParams.set('challenge', this.#challenge);
    u.searchParams.set('return', returnUrl);
    return u.href;
  }

  async call<M extends RpcMethod>(method: M, params: RpcMethods[M][0]): Promise<RpcMethods[M][1]> {
    await this.#ready;
    return this.#rawCall(method, params);
  }

  destroy(): void {
    window.removeEventListener('message', this.#onMessage);
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new FrameError('unavailable', 'Widget disconnected'));
    }
    this.#pending.clear();
    this.iframe.remove();
  }

  #rawCall<M extends RpcMethod>(method: M, params: RpcMethods[M][0]): Promise<RpcMethods[M][1]> {
    const win = this.iframe.contentWindow;
    if (!win) return Promise.reject(new FrameError('unavailable', 'Auth frame not attached'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id);
        reject(new FrameError('timeout', `Auth frame did not answer ${method}`));
      }, TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      win.postMessage({ pp: RPC_VERSION, id, method, params }, this.origin);
    });
  }

  #onMessage = (event: MessageEvent): void => {
    if (event.origin !== this.origin) return;
    const data: unknown = event.data;

    // The OAuth callback popup (same origin as the frame) hands back a sealed blob.
    if (event.source !== this.iframe.contentWindow) {
      if (isSealedSignIn(data)) void this.redeem(data.blob);
      return;
    }

    if (isRpcEvent(data)) {
      this.#viewer = data.viewer;
      this.#challenge = data.challenge;
      this.#events.onAuthChange(data.viewer);
      return;
    }
    if (!isRpcResponse(data)) return;
    const pending = this.#pending.get(data.id);
    if (!pending) return;
    this.#pending.delete(data.id);
    clearTimeout(pending.timer);
    if (data.ok) pending.resolve(data.result);
    else pending.reject(new FrameError(data.error.code, data.error.message));
  };

  /** Exchanges a sealed blob for a session inside the frame. */
  async redeem(blob: string): Promise<Viewer | null> {
    try {
      const { viewer } = await this.call('redeem', { blob });
      return viewer;
    } catch {
      return null;
    }
  }
}

/** Authenticated reads through the frame: higher rate limits, private repos. */
export class FrameBackend implements Backend {
  readonly kind = 'github-frame';
  constructor(readonly client: AuthFrame) {}
  listComments(ctx: PRContext): Promise<RawComment[]> {
    return this.client.call('listComments', { ctx });
  }
}
