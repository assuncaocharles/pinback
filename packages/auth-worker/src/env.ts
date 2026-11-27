/** Worker bindings and the helpers that read them. */

export interface Env {
  /** Comma-separated origins allowed to embed the frame (exact, or https://*.example.dev). */
  ALLOWED_ORIGINS: string;
  /** Optional comma-separated owner/repo list the frame will act on. Empty = any. */
  ALLOWED_REPOS?: string;
  GITHUB_CLIENT_ID?: string;
  /** Secret. */
  GITHUB_CLIENT_SECRET?: string;
  /** Secret. 32 random bytes, base64. Encrypts the sign-in handoff blob. */
  SESSION_KEY?: string;
  /** Test/GHES override for github.com OAuth endpoints. */
  GITHUB_OAUTH_BASE?: string;
  /** Test/GHES override for the REST API the frame calls. */
  GITHUB_API_BASE?: string;
  /** Optional R2 bucket for pin screenshots (ADR 11). Unbound = feature off. */
  SCREENSHOTS?: R2Bucket;
}

export function allowedRepos(env: Env): string[] {
  return (env.ALLOWED_REPOS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
