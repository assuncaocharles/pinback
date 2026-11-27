/** Response helpers shared by the worker's routes. */

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

/** Only the auth frame (same origin as the worker) may call frame-only endpoints. */
export function isSameOrigin(request: Request, url: URL): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return false;
  return request.headers.get('Origin') === url.origin;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' } });
}
