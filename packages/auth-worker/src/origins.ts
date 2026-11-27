/**
 * Origin allowlist shared by CORS and the iframe's postMessage checks.
 *
 * Entries are exact origins (`https://preview.example.com`) or a wildcard
 * for one leftmost label (`https://*.pages.dev`). The wildcard never
 * matches across dots, so `https://*.pages.dev` does not allow
 * `https://evil.com.pages.dev.attacker.io` or `https://a.b.pages.dev`.
 */
export type OriginMatcher = (origin: string) => boolean;

export function parseAllowlist(raw: string | undefined): OriginMatcher {
  const exact = new Set<string>();
  const wildcards: { scheme: string; suffix: string }[] = [];

  for (const entry of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(https?):\/\/\*\.([a-z0-9.-]+(?::\d+)?)$/i.exec(entry);
    if (m?.[1] && m[2]) {
      wildcards.push({ scheme: m[1].toLowerCase(), suffix: `.${m[2].toLowerCase()}` });
      continue;
    }
    const normalised = normaliseOrigin(entry);
    if (normalised) exact.add(normalised);
  }

  return (origin) => {
    const o = normaliseOrigin(origin);
    if (!o) return false;
    if (exact.has(o)) return true;
    const url = new URL(o);
    const scheme = url.protocol.slice(0, -1);
    return wildcards.some(({ scheme: s, suffix }) => {
      if (s !== scheme || !url.host.endsWith(suffix)) return false;
      const label = url.host.slice(0, -suffix.length);
      return /^[a-z0-9-]+$/.test(label);
    });
  };
}

function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // An origin has no path, query or credentials.
    if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}
