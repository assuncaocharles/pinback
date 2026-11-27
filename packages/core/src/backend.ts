import type { PRContext } from './types.js';

/**
 * A raw comment as stored by a backend. The widget never talks to a
 * forge directly; it goes through this interface so GitLab/Bitbucket can
 * be added later without touching anchoring or UI code.
 */
export interface RawComment {
  id: string;
  body: string;
  author: { login: string; avatarUrl: string };
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface Backend {
  readonly kind: string;
  listComments(ctx: PRContext, signal?: AbortSignal): Promise<RawComment[]>;
}
