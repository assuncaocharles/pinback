import {
  BackendError,
  GitHubBackend,
  RPC_VERSION,
  chooseReviewTarget,
  decodeMetadata,
  parseSource,
  encodeMetadata,
  formatCommentBody,
  isRpcRequest,
  type CreateCommentParams,
  type PinMetadata,
  type PRContext,
  type RawComment,
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
        return this.#listComments(this.#ctx(p.ctx));
      case 'createComment':
        this.#requireAuth();
        return this.#createComment(this.#ctx((p as Partial<CreateCommentParams>).ctx), p);
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

  /**
   * Comments plus, when signed in, GitHub's resolved state for review threads
   * (ADR 5). The GraphQL lookup is best-effort: on failure the widget falls
   * back to preview-pins state events.
   */
  async #listComments(ctx: PRContext): Promise<RawComment[]> {
    const comments = await this.#github.listComments(ctx);
    if (!this.#auth() || !comments.some((c) => c.kind === 'review')) return comments;
    try {
      const states = await this.#github.reviewThreadStates(ctx);
      return comments.map((c) => {
        const s = c.kind === 'review' ? states.get(c.id) : undefined;
        return s ? { ...c, threadResolved: s.isResolved } : c;
      });
    } catch {
      return comments;
    }
  }

  /**
   * Root pins on a file in the PR diff become review comments on that line
   * (ADR 10, docs/source-line-comments.md); everything else is a plain PR
   * comment. Replies stay where their thread lives.
   */
  async #createComment(ctx: PRContext, p: Record<string, unknown>): Promise<RawComment> {
    const { text, meta, previewUrl } = this.#prepare(p);
    const parentKind = p.parentKind === 'review' ? 'review' : 'issue';
    const plain = () => this.#github.createComment(ctx, formatCommentBody({ text, meta, ...(previewUrl ? { previewUrl } : {}) }));

    if (meta.parent !== null) {
      if (parentKind !== 'review') return plain();
      let created: RawComment;
      try {
        created = await this.#github.replyToReviewComment(ctx, String(meta.parent), formatCommentBody({ text, meta }));
      } catch (err) {
        if (!isFallbackable(err)) throw err;
        created = await plain();
      }
      if (meta.state) await this.#syncReviewThread(ctx, String(meta.parent), meta.state === 'resolved');
      return created;
    }

    // A review comment must target the exact commit the preview was built from.
    if (!/^[0-9a-f]{40}$/i.test(ctx.commitSha) || !meta.anchor.source) return plain();
    let target;
    try {
      target = chooseReviewTarget(await this.#github.listPullFiles(ctx), meta.anchor.source);
    } catch {
      return plain();
    }
    if (target.kind !== 'review') return plain();
    const loc = parseSource(meta.anchor.source);
    const elementAt = !target.exact && loc ? `${loc.path}:${loc.line}` : undefined;
    const body = formatCommentBody({
      text,
      meta,
      ...(previewUrl ? { previewUrl } : {}),
      ...(elementAt ? { elementAt } : {}),
    });
    try {
      return await this.#github.createReviewComment(ctx, { body, path: target.path, line: target.line, commitSha: ctx.commitSha });
    } catch (err) {
      // e.g. 422: line not in the diff at that commit (the PR moved on).
      if (!isFallbackable(err)) throw err;
      return plain();
    }
  }

  /** Mirrors a preview-pins resolve/reopen onto GitHub's review thread. Best-effort. */
  async #syncReviewThread(ctx: PRContext, rootId: string, resolved: boolean): Promise<void> {
    try {
      const thread = (await this.#github.reviewThreadStates(ctx)).get(rootId);
      if (thread && thread.isResolved !== resolved) await this.#github.setReviewThreadResolved(thread.threadId, resolved);
    } catch {
      // The state event is already posted; GitHub's UI just won't mirror it.
    }
  }

  /** Validates the request and normalises its parts; the body is always built here. */
  #prepare(p: Record<string, unknown>): { text: string; meta: PinMetadata; previewUrl?: string } {
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
    return { text, meta, ...(previewUrl ? { previewUrl } : {}) };
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

/** Errors after which a plain PR comment is still worth trying. */
function isFallbackable(err: unknown): boolean {
  return err instanceof BackendError && (err.code === 'invalid' || err.code === 'not-found' || err.code === 'http');
}
