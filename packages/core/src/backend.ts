import type { PRContext } from './types.js';

/**
 * GitHub's author_association values. Used to decide who may resolve a
 * thread (ADR 5).
 */
export type AuthorAssociation =
  | 'OWNER'
  | 'MEMBER'
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'FIRST_TIMER'
  | 'MANNEQUIN'
  | 'NONE';

/**
 * A comment as stored by a backend. The widget never talks to a forge
 * directly; it goes through this interface so GitLab/Bitbucket can be added
 * later without touching anchoring or UI code.
 */
export interface RawComment {
  id: string;
  /** Raw markdown, including the hidden metadata block. */
  body: string;
  /** HTML rendered and sanitized by the forge. Still sanitized again before display. */
  bodyHtml: string;
  author: { login: string; avatarUrl: string; association: AuthorAssociation };
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  /** "issue" = plain PR conversation comment, "review" = comment on a diff line. */
  kind: 'issue' | 'review';
  /** Review comments only: the comment this one replies to in a GitHub review thread. */
  inReplyTo?: string;
  /**
   * Review thread roots only, when known (needs a token): GitHub's own
   * "resolved" state, which wins over preview-pins state events (ADR 5).
   */
  threadResolved?: boolean;
}

export interface Backend {
  readonly kind: string;
  listComments(ctx: PRContext, signal?: AbortSignal): Promise<RawComment[]>;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'rate-limited' | 'network' | 'http' | 'unauthenticated' | 'forbidden' | 'invalid',
    /** For rate-limited: when the limit resets. */
    readonly resetAt?: Date,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}
