import {
  BackendError,
  GitHubBackend,
  RPC_VERSION,
  decodeMetadata,
  encodeMetadata,
  formatCommentBody,
  isRpcRequest,
  type CreateCommentParams,
  type PRContext,
  type RpcErrorCode,
  type RpcEvent,
  type RpcMethod,
  type RpcMethods,
  type RpcRequest,
  type RpcResponse,
  type Viewer,
} from '@preview-pins/core';
import { randomToken, sha256b64url } from '../crypto.js';
import type { FrameConfig, TokenSet } from '../types.js';
import { parseAllowlist } from '../origins.js';

const AUTH_KEY = 'pp:auth';
const SECRET_KEY = 'pp:secret';
const REFRESH_SKEW_MS = 60_000;
const MAX_TEXT = 60_000;

interface StoredAuth {
  tokens: TokenSet;
  viewer: Viewer;
}

export interface FrameDeps {
  config: FrameConfig;
  /** Frame-origin storage. Partitioned by the top-level site in modern browsers. */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetch: typeof fetch;
  /** The worker's own origin (same-origin endpoints /auth/redeem, /auth/refresh). */
  workerOrigin: string;
  /** window.parent. Messages from anything else are ignored. */
  parent: MessageEventSource;
  post(message: RpcResponse | RpcEvent, targetOrigin: string): void;
  now?: () => number;
}

class RpcError extends Error {
  constructor(
    readonly code: RpcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The auth frame's RPC server. It holds the user token and performs every
 * authenticated GitHub call. The host page can ask it to do a fixed set of
 * things, but can never read the token: nothing below ever puts it in a
 * message. See ADR 7.
 */
export class FrameServer {
  readonly #d: FrameDeps;
  readonly #allowed: (origin: string) => boolean;
  readonly #github: GitHubBackend;
  #parentOrigin: string | null = null;
  #refreshing: Promise<string | null> | null = null;

  constructor(deps: FrameDeps) {
    this.#d = deps;
    this.#allowed = parseAllowlist(deps.config.allowedOrigins);
    this.#github = new GitHubBackend({
      apiBase: deps.config.apiBase,
      fetch: deps.fetch,
      token: () => this.#token(),
    });
  }

  get parentOrigin(): string | null {
    return this.#parentOrigin;
  }

  /** window 'message' listener. */
  handle = (event: MessageEvent): void => {
    if (event.source !== this.#d.parent) return;
    if (!this.#allowed(event.origin)) return;
    if (this.#parentOrigin && event.origin !== this.#parentOrigin) return;
    const data: unknown = event.data;
    if (!isRpcRequest(data)) return;
    if (data.method === 'hello') this.#parentOrigin = event.origin;
    if (!this.#parentOrigin) return; // must say hello first
    void this.#dispatch(data, this.#parentOrigin);
  };

  /** window 'storage' listener: another tab signed in or out. */
  onStorage = (): void => {
    void this.#emitAuth();
  };

  async #dispatch(req: RpcRequest, origin: string): Promise<void> {
    try {
      const result = await this.#run(req);
      this.#d.post({ pp: RPC_VERSION, id: req.id, ok: true, result }, origin);
    } catch (err) {
      const e = toRpcError(err);
      if (err instanceof BackendError && err.code === 'unauthenticated') await this.handleUnauthenticated();
      this.#d.post({ pp: RPC_VERSION, id: req.id, ok: false, error: { code: e.code, message: e.message } }, origin);
    }
  }

  async #run(req: RpcRequest): Promise<RpcMethods[RpcMethod][1]> {
    const p = req.params as Record<string, unknown>;
    switch (req.method) {
      case 'hello':
        return { viewer: this.#auth()?.viewer ?? null, challenge: await this.#challenge() };
      case 'redeem':
        return this.#redeem(p);
      case 'signOut':
        this.#d.storage.removeItem(AUTH_KEY);
        await this.#emitAuth();
        return null;
      case 'listComments':
        return this.#github.listComments(this.#ctx(p.ctx));
      case 'createComment':
        this.#requireAuth();
        return this.#github.createComment(this.#ctx((p as Partial<CreateCommentParams>).ctx), this.#body(p));
      case 'renderMarkdown': {
        this.#requireAuth();
        const text = p.text;
        if (typeof text !== 'string' || text.length > MAX_TEXT) throw new RpcError('invalid', 'text');
        return this.#github.renderMarkdown(this.#ctx(p.ctx), text);
      }
      case 'canMaintain':
        this.#requireAuth();
        return this.#github.canMaintain(this.#ctx(p.ctx));
    }
  }

  #ctx(raw: unknown): PRContext {
    const c = raw as Partial<PRContext> | undefined;
    const name = /^[A-Za-z0-9_.-]{1,100}$/;
    if (
      !c ||
      typeof c.owner !== 'string' ||
      !name.test(c.owner) ||
      typeof c.repo !== 'string' ||
      !name.test(c.repo) ||
      typeof c.prNumber !== 'number' ||
      !Number.isInteger(c.prNumber) ||
      c.prNumber <= 0 ||
      typeof c.commitSha !== 'string'
    ) {
      throw new RpcError('invalid', 'Invalid PR context');
    }
    const repos = this.#d.config.allowedRepos;
    if (repos.length && !repos.includes(`${c.owner}/${c.repo}`.toLowerCase())) {
      throw new RpcError('forbidden', `${c.owner}/${c.repo} is not allowed by this auth worker`);
    }
    return { owner: c.owner, repo: c.repo, prNumber: c.prNumber, commitSha: c.commitSha };
  }

  /** Builds the comment body here, so the metadata block is always well-formed. */
  #body(p: Record<string, unknown>): string {
    const text = p.text;
    // Round-trip through the codec: anything that wouldn't parse back is rejected.
    const meta = decodeMetadata(encodeMetadata(p.meta as never));
    if (!meta) throw new RpcError('invalid', 'Invalid pin metadata');
    // State events (resolve/reopen) may have no text; everything else must.
    const emptyOk = meta.state !== undefined && meta.parent !== null;
    if (typeof text !== 'string' || text.length > MAX_TEXT || (!text.trim() && !emptyOk)) {
      throw new RpcError('invalid', 'Comment text is empty or too long');
    }
    let previewUrl: string | undefined;
    if (typeof p.previewUrl === 'string') {
      try {
        const u = new URL(p.previewUrl);
        if (u.protocol === 'https:' || u.protocol === 'http:') previewUrl = u.href;
      } catch {
        // ignore
      }
    }
    return formatCommentBody({ text, meta, ...(previewUrl ? { previewUrl } : {}) });
  }

  async #redeem(p: Record<string, unknown>): Promise<{ viewer: Viewer }> {
    if (typeof p.blob !== 'string') throw new RpcError('invalid', 'blob');
    const secret = this.#secret();
    const res = await this.#d.fetch(`${this.#d.workerOrigin}/auth/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: p.blob, secret }),
    });
    if (!res.ok) throw new RpcError('unauthenticated', 'Sign-in could not be completed. Try again.');
    const tokens = (await res.json()) as TokenSet;
    // One secret per sign-in: a replayed blob can't be redeemed again.
    this.#d.storage.setItem(SECRET_KEY, randomToken());
    const viewer = await new GitHubBackend({
      apiBase: this.#d.config.apiBase,
      fetch: this.#d.fetch,
      token: () => Promise.resolve(tokens.accessToken),
    }).getViewer();
    this.#d.storage.setItem(AUTH_KEY, JSON.stringify({ tokens, viewer } satisfies StoredAuth));
    await this.#emitAuth();
    return { viewer };
  }

  #auth(): StoredAuth | null {
    try {
      const raw = this.#d.storage.getItem(AUTH_KEY);
      const v = raw ? (JSON.parse(raw) as StoredAuth) : null;
      return v && typeof v.tokens.accessToken === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  #requireAuth(): void {
    if (!this.#auth()) throw new RpcError('unauthenticated', 'Sign in to continue');
  }

  #secret(): string {
    let s = this.#d.storage.getItem(SECRET_KEY);
    if (!s) {
      s = randomToken();
      this.#d.storage.setItem(SECRET_KEY, s);
    }
    return s;
  }

  #challenge(): Promise<string> {
    return sha256b64url(this.#secret());
  }

  async #token(): Promise<string | null> {
    const auth = this.#auth();
    if (!auth) return null;
    const now = (this.#d.now ?? Date.now)();
    const { tokens } = auth;
    if (!tokens.expiresAt || tokens.expiresAt - REFRESH_SKEW_MS > now) return tokens.accessToken;
    if (!tokens.refreshToken || (tokens.refreshExpiresAt && tokens.refreshExpiresAt < now)) {
      await this.#signOutExpired();
      return null;
    }
    this.#refreshing ??= this.#refresh(auth).finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #refresh(auth: StoredAuth): Promise<string | null> {
    const res = await this.#d.fetch(`${this.#d.workerOrigin}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.tokens.refreshToken }),
    });
    if (!res.ok) {
      await this.#signOutExpired();
      return null;
    }
    const tokens = (await res.json()) as TokenSet;
    this.#d.storage.setItem(AUTH_KEY, JSON.stringify({ tokens, viewer: auth.viewer } satisfies StoredAuth));
    return tokens.accessToken;
  }

  async #signOutExpired(): Promise<void> {
    this.#d.storage.removeItem(AUTH_KEY);
    await this.#emitAuth();
  }

  async #emitAuth(): Promise<void> {
    if (!this.#parentOrigin) return;
    this.#d.post(
      { pp: RPC_VERSION, event: 'auth-changed', viewer: this.#auth()?.viewer ?? null, challenge: await this.#challenge() },
      this.#parentOrigin,
    );
  }

  /** Called when GitHub says the token is bad. */
  async handleUnauthenticated(): Promise<void> {
    if (this.#auth()) await this.#signOutExpired();
  }
}

function toRpcError(err: unknown): RpcError {
  if (err instanceof RpcError) return err;
  if (err instanceof BackendError) {
    const map: Record<BackendError['code'], RpcErrorCode> = {
      'not-found': 'not-found',
      'rate-limited': 'rate-limited',
      network: 'network',
      http: 'http',
      unauthenticated: 'unauthenticated',
      forbidden: 'forbidden',
      invalid: 'invalid',
    };
    return new RpcError(map[err.code], err.message);
  }
  return new RpcError('internal', 'Unexpected error');
}
