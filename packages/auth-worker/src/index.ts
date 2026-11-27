import { b64url, randomToken, seal, sha256b64url, timingSafeEqual, unseal, fromB64url } from './crypto.js';
import { escapeHtml, page } from './html.js';
import { SECURITY_HEADERS, isSameOrigin, json } from './http.js';
import { SCREENSHOT_PATH_PREFIX, serveScreenshot, uploadScreenshot } from './screenshots.js';
import { allowedRepos, type Env } from './env.js';
import { parseAllowlist } from './origins.js';
import type { CallbackData, FrameConfig, TokenSet } from './types.js';

export type { CallbackData, FrameConfig, TokenSet } from './types.js';
export type { Env } from './env.js';


interface SealedPayload {
  tokens: TokenSet;
  /** b64url(SHA-256(frame secret)). */
  ch: string;
  iat: number;
}

interface OAuthCookie {
  state: string;
  verifier: string;
  ch: string;
  ret: string;
}

const COOKIE = '__Host-pp_oauth';
const BLOB_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;


/**
 * Stateless auth worker. Routes:
 *   GET  /health          liveness
 *   GET  /frame           the auth iframe (token lives here, never in the host page)
 *   GET  /auth/start      begins GitHub App OAuth (PKCE) in a popup
 *   GET  /auth/callback   exchanges the code, returns a sealed blob bound to the frame's challenge
 *   POST /auth/redeem     frame-only: sealed blob + frame secret -> tokens
 *   POST /auth/refresh    frame-only: refresh token -> new tokens
 *   POST /screenshots     frame-only, needs a GitHub token with repo access: store a PNG/WebP/JPEG in R2
 *   GET  /s/<key>         serve a stored screenshot (unguessable key)
 * Static assets (/frame.js, /callback.js) are served by Workers Assets.
 * See ADR 7.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isAllowed = parseAllowlist(env.ALLOWED_ORIGINS);
    try {
      if (request.method === 'GET' && url.pathname.startsWith(SCREENSHOT_PATH_PREFIX)) {
        return await serveScreenshot(env, url.pathname.slice(SCREENSHOT_PATH_PREFIX.length));
      }
      switch (`${request.method} ${url.pathname}`) {
        case 'POST /screenshots':
          return await uploadScreenshot(request, env, url);
        case 'GET /health':
          return health(request, isAllowed);
        case 'GET /frame':
          return frame(env, url);
        case 'GET /auth/start':
          return await start(request, env, url, isAllowed);
        case 'GET /auth/callback':
          return await callback(request, env, url, isAllowed);
        case 'POST /auth/redeem':
          return await redeem(request, env, url);
        case 'POST /auth/refresh':
          return await refresh(request, env, url);
        case 'OPTIONS /health': {
          const origin = request.headers.get('Origin');
          if (!origin || !isAllowed(origin)) return new Response(null, { status: 403 });
          return new Response(null, {
            status: 204,
            headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET', Vary: 'Origin' },
          });
        }
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (err) {
      console.error(err);
      return new Response('Internal error', { status: 500, headers: SECURITY_HEADERS });
    }
  },
} satisfies ExportedHandler<Env>;

function health(request: Request, isAllowed: (o: string) => boolean): Response {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = { 'Content-Type': 'text/plain', Vary: 'Origin' };
  if (origin && isAllowed(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response('ok', { headers });
}

/** CSP source list from the allowlist. Same syntax: exact origins and https://*.host. */
function frameAncestors(raw: string): string {
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(s));
  return list.length ? list.join(' ') : "'none'";
}

function frame(env: Env, url: URL): Response {
  const apiBase = (env.GITHUB_API_BASE ?? 'https://api.github.com').replace(/\/+$/, '');
  const config: FrameConfig = {
    allowedOrigins: env.ALLOWED_ORIGINS,
    allowedRepos: allowedRepos(env),
    apiBase,
    screenshots: !!env.SCREENSHOTS,
  };
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    `connect-src 'self' ${new URL(apiBase).origin}`,
    `frame-ancestors ${frameAncestors(env.ALLOWED_ORIGINS)}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return new Response(
    page({ title: 'pinback auth', body: '<p>pinback auth frame.</p>', data: config, script: `${url.origin}/frame.js`, style: false }),
    { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp } },
  );
}

function htmlResponse(title: string, body: string, data?: unknown, script?: string, status = 200): Response {
  return new Response(page({ title, body, data, script }), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

function errorPage(message: string, status = 400): Response {
  return htmlResponse('Sign-in failed', `<h1>Sign-in failed</h1><p>${escapeHtml(message)}</p><p>You can close this window.</p>`, undefined, undefined, status);
}

function requireConfig(env: Env): { clientId: string; clientSecret: string; sessionKey: string } {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_KEY) {
    throw new Error('Worker is missing GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET or SESSION_KEY');
  }
  return { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, sessionKey: env.SESSION_KEY };
}

function oauthBase(env: Env): string {
  return (env.GITHUB_OAUTH_BASE ?? 'https://github.com').replace(/\/+$/, '');
}

async function start(request: Request, env: Env, url: URL, isAllowed: (o: string) => boolean): Promise<Response> {
  const { clientId } = requireConfig(env);
  const ch = url.searchParams.get('challenge') ?? '';
  const ret = url.searchParams.get('return') ?? '';
  if (!CHALLENGE_RE.test(ch)) return errorPage('Missing or malformed challenge.');
  let retUrl: URL;
  try {
    retUrl = new URL(ret);
  } catch {
    return errorPage('Missing return URL.');
  }
  if (!isAllowed(retUrl.origin)) return errorPage(`${retUrl.origin} is not an allowed preview origin.`, 403);

  const state = randomToken(16);
  const verifier = randomToken(32);
  const cookie: OAuthCookie = { state, verifier, ch, ret: retUrl.href };
  const authorize = new URL(`${oauthBase(env)}/login/oauth/authorize`);
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', await sha256b64url(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');

  return new Response(null, {
    status: 302,
    headers: {
      ...SECURITY_HEADERS,
      Location: authorize.href,
      'Set-Cookie': `${COOKIE}=${b64url(new TextEncoder().encode(JSON.stringify(cookie)))}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}

function readCookie(request: Request): OAuthCookie | null {
  const header = request.headers.get('Cookie') ?? '';
  const raw = header
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(fromB64url(raw))) as Partial<OAuthCookie>;
    if (typeof v.state === 'string' && typeof v.verifier === 'string' && typeof v.ch === 'string' && typeof v.ret === 'string') {
      return v as OAuthCookie;
    }
  } catch {
    // fall through
  }
  return null;
}

async function callback(request: Request, env: Env, url: URL, isAllowed: (o: string) => boolean): Promise<Response> {
  const { clientId, clientSecret, sessionKey } = requireConfig(env);
  const clear = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
  const fail = (msg: string, status = 400) => {
    const res = errorPage(msg, status);
    res.headers.append('Set-Cookie', clear);
    return res;
  };

  if (url.searchParams.get('error')) return fail('Sign-in was cancelled.');
  const cookie = readCookie(request);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!cookie || !state || !timingSafeEqual(cookie.state, state)) return fail('Sign-in expired or was started elsewhere. Try again.');
  if (!code) return fail('GitHub did not return a code.');
  const ret = new URL(cookie.ret);
  if (!isAllowed(ret.origin)) return fail('Return origin is no longer allowed.', 403);

  const tokens = await exchange(env, {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: `${url.origin}/auth/callback`,
    code_verifier: cookie.verifier,
  });
  if (!tokens) return fail('GitHub rejected the sign-in. Try again.', 502);

  const payload: SealedPayload = { tokens, ch: cookie.ch, iat: Date.now() };
  const blob = await seal(sessionKey, payload);
  ret.hash = '';
  const data: CallbackData = { blob, returnOrigin: ret.origin, returnUrl: ret.href };
  const res = htmlResponse('Signing in…', '<p>Signed in. Returning to the preview…</p>', data, `${url.origin}/callback.js`);
  res.headers.append('Set-Cookie', clear);
  return res;
}

async function exchange(env: Env, params: Record<string, string>): Promise<TokenSet | null> {
  const res = await fetch(`${oauthBase(env)}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) return null;
  const data: Record<string, unknown> = await res.json();
  if (typeof data.access_token !== 'string' || !data.access_token) return null;
  const now = Date.now();
  const tokens: TokenSet = { accessToken: data.access_token };
  if (typeof data.refresh_token === 'string') tokens.refreshToken = data.refresh_token;
  if (typeof data.expires_in === 'number') tokens.expiresAt = now + data.expires_in * 1000;
  if (typeof data.refresh_token_expires_in === 'number') tokens.refreshExpiresAt = now + data.refresh_token_expires_in * 1000;
  return tokens;
}


async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await request.json();
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function redeem(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  const { sessionKey } = requireConfig(env);
  const body = await readJson(request);
  const blob = body?.blob;
  const secret = body?.secret;
  if (typeof blob !== 'string' || typeof secret !== 'string') return json({ error: 'invalid' }, 400);
  const payload = (await unseal(sessionKey, blob)) as SealedPayload | null;
  if (!payload || typeof payload.ch !== 'string' || typeof payload.iat !== 'number') return json({ error: 'invalid' }, 400);
  if (Date.now() - payload.iat > BLOB_TTL_MS) return json({ error: 'expired' }, 400);
  if (!timingSafeEqual(await sha256b64url(secret), payload.ch)) return json({ error: 'forbidden' }, 403);
  return json(payload.tokens);
}

async function refresh(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  const { clientId, clientSecret } = requireConfig(env);
  const body = await readJson(request);
  const refreshToken = body?.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) return json({ error: 'invalid' }, 400);
  const tokens = await exchange(env, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  return tokens ? json(tokens) : json({ error: 'refresh-failed' }, 401);
}
