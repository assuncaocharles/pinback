import { BackendError, type AuthorAssociation, type Backend, type RawComment } from './backend.js';
import type { PrFile } from './diff.js';
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
  in_reply_to_id?: number;
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

  /** GET /pulls/{n}/files (paginated, ETag-cached). */
  async listPullFiles(ctx: PRContext, signal?: AbortSignal): Promise<PrFile[]> {
    const files = (await this.#paginate(`${this.#repoUrl(ctx)}/pulls/${ctx.prNumber}/files?per_page=100`, signal)) as unknown as {
      filename: string;
      status: string;
      patch?: string;
    }[];
    return files.map((f) => ({ filename: f.filename, status: f.status, ...(f.patch ? { patch: f.patch } : {}) }));
  }

  /** POST /pulls/{n}/comments on the RIGHT side of `line`. Requires a token. */
  async createReviewComment(
    ctx: PRContext,
    args: { body: string; path: string; line: number; commitSha: string },
  ): Promise<RawComment> {
    const res = await this.#send(`${this.#repoUrl(ctx)}/pulls/${ctx.prNumber}/comments`, {
      method: 'POST',
      headers: await this.#headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ body: args.body, commit_id: args.commitSha, path: args.path, line: args.line, side: 'RIGHT' }),
    });
    return toRaw((await res.json()) as GitHubComment, 'review');
  }

  /** POST /pulls/{n}/comments/{id}/replies: a native reply in a review thread. */
  async replyToReviewComment(ctx: PRContext, commentId: string, body: string): Promise<RawComment> {
    const res = await this.#send(
      `${this.#repoUrl(ctx)}/pulls/${ctx.prNumber}/comments/${encodeURIComponent(commentId)}/replies`,
      { method: 'POST', headers: await this.#headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ body }) },
    );
    return toRaw((await res.json()) as GitHubComment, 'review');
  }

  async #graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.#send(graphqlUrl(this.#apiBase), {
      method: 'POST',
      headers: await this.#headers({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length || !json.data) throw new BackendError(json.errors?.[0]?.message ?? 'GraphQL error', 'http');
    return json.data;
  }

  /** Review threads keyed by their first comment's REST id. Requires a token. */
  async reviewThreadStates(ctx: PRContext): Promise<Map<string, ReviewThreadState>> {
    const out = new Map<string, ReviewThreadState>();
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      type Data = {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: { id: string; isResolved: boolean; comments: { nodes: { databaseId: number | null }[] } }[];
            };
          } | null;
        } | null;
      };
      const data: Data = await this.#graphql<Data>(
        `query($owner:String!,$repo:String!,$pr:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}`,
        { owner: ctx.owner, repo: ctx.repo, pr: ctx.prNumber, after },
      );
      const threads = data.repository?.pullRequest?.reviewThreads;
      if (!threads) break;
      for (const t of threads.nodes) {
        const first = t.comments.nodes[0]?.databaseId;
        if (first) out.set(String(first), { threadId: t.id, isResolved: t.isResolved });
      }
      if (!threads.pageInfo.hasNextPage) break;
      after = threads.pageInfo.endCursor;
    }
    return out;
  }

  /** Resolves or unresolves a review thread on GitHub. Requires a token. */
  async setReviewThreadResolved(threadId: string, resolved: boolean): Promise<void> {
    const mutation = resolved
      ? 'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}'
      : 'mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{id}}}';
    await this.#graphql(mutation, { id: threadId });
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
    ...(c.in_reply_to_id ? { inReplyTo: String(c.in_reply_to_id) } : {}),
  };
}

export interface ReviewThreadState {
  threadId: string;
  isResolved: boolean;
}

function graphqlUrl(apiBase: string): string {
  // api.github.com/graphql, or GHES: https://host/api/v3 -> https://host/api/graphql
  return apiBase.endsWith('/api/v3') ? `${apiBase.slice(0, -3)}graphql` : `${apiBase}/graphql`;
}
