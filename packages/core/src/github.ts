import { BackendError, type AuthorAssociation, type Backend, type RawComment } from './backend.js';
import type { PRContext } from './types.js';

export interface GitHubBackendOptions {
  /** Defaults to https://api.github.com. Override for GitHub Enterprise or tests. */
  apiBase?: string;
  fetch?: typeof fetch;
  /**
   * Returns a user token, or null for anonymous requests. Only ever passed
   * inside the auth frame; the widget's own backend is always anonymous.
   */
  token?: () => Promise<string | null>;
}

interface CacheEntry {
  etag: string;
  data: unknown[];
  next: string | null;
}

interface GitHubComment {
  id: number;
  body?: string | null;
  body_html?: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  author_association?: string;
  user: { login: string; avatar_url: string } | null;
}

/**
 * Read-only GitHub backend for M1. No token: unauthenticated requests are
 * limited to 60/hour per IP, so every page is cached in memory with its
 * ETag and re-requested with If-None-Match. 304 responses don't count
 * against the limit.
 */
export class GitHubBackend implements Backend {
  readonly kind = 'github';
  readonly #apiBase: string;
  readonly #fetch: typeof fetch;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #token: () => Promise<string | null>;

  constructor(options: GitHubBackendOptions = {}) {
    this.#apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#token = options.token ?? (() => Promise.resolve(null));
  }

  #repoUrl(ctx: PRContext): string {
    return `${this.#apiBase}/repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`;
  }

  async #headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.full+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
    const token = await this.#token();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async #send(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.#fetch(url, init);
    } catch (err) {
      if (init.signal?.aborted) throw err;
      throw new BackendError(`Network error fetching ${url}`, 'network');
    }
    if (!res.ok) throw toError(res, url);
    return res;
  }

  /** POST /repos/{o}/{r}/issues/{n}/comments. Requires a token. */
  async createComment(ctx: PRContext, body: string): Promise<RawComment> {
    const res = await this.#send(`${this.#repoUrl(ctx)}/issues/${ctx.prNumber}/comments`, {
      method: 'POST',
      headers: await this.#headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ body }),
    });
    return toRaw((await res.json()) as GitHubComment, 'issue');
  }

  /** POST /markdown in GFM mode, so #123 and @mentions resolve against the repo. */
  async renderMarkdown(ctx: PRContext, text: string): Promise<string> {
    const res = await this.#send(`${this.#apiBase}/markdown`, {
      method: 'POST',
      headers: await this.#headers({ Accept: 'text/html', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, mode: 'gfm', context: `${ctx.owner}/${ctx.repo}` }),
    });
    return res.text();
  }

  /** GET /user. */
  async getViewer(): Promise<{ login: string; avatarUrl: string }> {
    const res = await this.#send(`${this.#apiBase}/user`, { headers: await this.#headers() });
    const user = (await res.json()) as { login: string; avatar_url: string };
    return { login: user.login, avatarUrl: user.avatar_url };
  }

  /** Whether the viewer has push (or higher) access to the repo. */
  async canMaintain(ctx: PRContext): Promise<boolean> {
    const res = await this.#send(this.#repoUrl(ctx), { headers: await this.#headers() });
    const repo = (await res.json()) as { permissions?: { push?: boolean; maintain?: boolean; admin?: boolean } };
    const p = repo.permissions;
    return !!(p?.push || p?.maintain || p?.admin);
  }

  async listComments(ctx: PRContext, signal?: AbortSignal): Promise<RawComment[]> {
    const base = this.#repoUrl(ctx);
    const [issue, review] = await Promise.all([
      this.#paginate(`${base}/issues/${ctx.prNumber}/comments?per_page=100`, signal),
      this.#paginate(`${base}/pulls/${ctx.prNumber}/comments?per_page=100`, signal),
    ]);
    return [...issue.map((c) => toRaw(c, 'issue')), ...review.map((c) => toRaw(c, 'review'))];
  }

  async #paginate(firstUrl: string, signal?: AbortSignal): Promise<GitHubComment[]> {
    const out: GitHubComment[] = [];
    let url: string | null = firstUrl;
    // Hard cap so a bad Link header can't loop forever: 50 pages = 5000 comments.
    for (let page = 0; url && page < 50; page++) {
      const entry = await this.#get(url, signal);
      out.push(...(entry.data as GitHubComment[]));
      url = entry.next;
    }
    return out;
  }

  async #get(url: string, signal?: AbortSignal): Promise<CacheEntry> {
    const cached = this.#cache.get(url);
    const headers = await this.#headers(cached ? { 'If-None-Match': cached.etag } : {});

    let res: Response;
    try {
      // no-store: we do our own conditional requests, and we need to see the 304.
      res = await this.#fetch(url, { headers, cache: 'no-store', ...(signal ? { signal } : {}) });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new BackendError(`Network error fetching ${url}`, 'network');
    }

    if (res.status === 304 && cached) return cached;
    if (res.ok) {
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new BackendError(`Unexpected response from ${url}`, 'http');
      const entry: CacheEntry = { etag: res.headers.get('ETag') ?? '', data, next: nextLink(res.headers.get('Link')) };
      if (entry.etag) this.#cache.set(url, entry);
      return entry;
    }
    throw toError(res, url);
  }
}

function toError(res: Response, url: string): BackendError {
  const remaining = res.headers.get('X-RateLimit-Remaining');
  if (res.status === 429 || (res.status === 403 && remaining === '0')) {
    const reset = Number(res.headers.get('X-RateLimit-Reset'));
    return new BackendError('GitHub rate limit reached', 'rate-limited', reset ? new Date(reset * 1000) : undefined);
  }
  if (res.status === 401) return new BackendError('GitHub rejected the token', 'unauthenticated');
  if (res.status === 403) return new BackendError(`Forbidden: ${url}`, 'forbidden');
  if (res.status === 422) return new BackendError(`GitHub rejected the request for ${url}`, 'invalid');
  // Private repos look like 404 without a token.
  if (res.status === 404) return new BackendError(`Not found: ${url}`, 'not-found');
  return new BackendError(`GitHub responded ${res.status} for ${url}`, 'http');
}

/** Parses `<https://...>; rel="next", <...>; rel="last"`. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m?.[1]) return m[1];
  }
  return null;
}

const ASSOCIATIONS = new Set<string>([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'MANNEQUIN',
  'NONE',
]);

function toRaw(c: GitHubComment, kind: RawComment['kind']): RawComment {
  const assoc = c.author_association && ASSOCIATIONS.has(c.author_association) ? c.author_association : 'NONE';
  return {
    id: String(c.id),
    body: c.body ?? '',
    bodyHtml: c.body_html ?? '',
    author: {
      login: c.user?.login ?? 'ghost',
      avatarUrl: c.user?.avatar_url ?? '',
      association: assoc as AuthorAssociation,
    },
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    htmlUrl: c.html_url,
    kind,
  };
}
