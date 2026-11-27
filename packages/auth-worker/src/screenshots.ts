import { randomToken } from './crypto.js';
import { SECURITY_HEADERS, isSameOrigin, json } from './http.js';
import { allowedRepos, type Env } from './env.js';

/**
 * Pin screenshots (M5 stretch, ADR 11). The frame uploads an image with the
 * reviewer's GitHub token; the worker checks that the token can see the repo,
 * stores the image in R2 under an unguessable key, and serves it publicly so
 * GitHub can render it inside the comment.
 */

export const SCREENSHOT_PATH_PREFIX = '/s/';
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const KEY_RE = /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}\/[A-Za-z0-9_-]{22}\.(png|webp|jpg)$/;

const TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': {
    ext: 'webp',
    magic: (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  },
};
const EXT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export async function uploadScreenshot(request: Request, env: Env, url: URL): Promise<Response> {
  const bucket = env.SCREENSHOTS;
  if (!bucket) return json({ error: 'screenshots-disabled' }, 501);
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403);

  const owner = url.searchParams.get('owner') ?? '';
  const repo = url.searchParams.get('repo') ?? '';
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return json({ error: 'invalid' }, 400);
  const repos = allowedRepos(env);
  const slug = `${owner}/${repo}`.toLowerCase();
  if (repos.length && !repos.includes(slug)) return json({ error: 'forbidden' }, 403);

  const auth = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) return json({ error: 'unauthenticated' }, 401);

  const type = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim() ?? '';
  const kind = TYPES[type];
  if (!kind) return json({ error: 'unsupported-type' }, 415);
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_SCREENSHOT_BYTES) return json({ error: 'too-large' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) return json({ error: 'too-large' }, 413);
  if (!kind.magic(bytes)) return json({ error: 'unsupported-type' }, 415);

  // The token must be able to see the repo: the worker is not an open file host.
  const apiBase = (env.GITHUB_API_BASE ?? 'https://api.github.com').replace(/\/+$/, '');
  const check = await fetch(`${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: { Authorization: auth, Accept: 'application/vnd.github+json', 'User-Agent': 'preview-pins-auth' },
  });
  if (check.status === 401) return json({ error: 'unauthenticated' }, 401);
  if (!check.ok) return json({ error: 'forbidden' }, 403);

  const key = `${slug}/${randomToken(16)}.${kind.ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  return json({ url: `${url.origin}${SCREENSHOT_PATH_PREFIX}${key}` }, 201);
}

export async function serveScreenshot(env: Env, key: string): Promise<Response> {
  const bucket = env.SCREENSHOTS;
  if (!bucket || !KEY_RE.test(key)) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  const object = await bucket.get(key);
  if (!object) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  const ext = key.slice(key.lastIndexOf('.') + 1);
  return new Response(object.body, {
    headers: {
      // Type comes from the key, which was derived from the sniffed upload.
      'Content-Type': EXT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
