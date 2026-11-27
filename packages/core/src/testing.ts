import type { AuthorAssociation, RawComment } from './backend.js';
import { formatCommentBody, type PinMetadata } from './metadata.js';

/** Test helper: a RawComment carrying pin metadata. Not exported from the package index. */
export function rawPin(
  id: number,
  text: string,
  meta: Partial<PinMetadata> = {},
  opts: { login?: string; association?: AuthorAssociation; createdAt?: string; kind?: RawComment['kind'] } = {},
): RawComment {
  const full: PinMetadata = {
    anchor: {},
    viewport: { w: 1280, h: 800 },
    url: '/',
    sha: 'abc1234',
    parent: null,
    ...meta,
  };
  return {
    id: String(id),
    body: formatCommentBody({ text, meta: full }),
    bodyHtml: `<p>${text}</p>`,
    author: { login: opts.login ?? 'alice', avatarUrl: '', association: opts.association ?? 'NONE' },
    createdAt: opts.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
    updatedAt: opts.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
    htmlUrl: `https://github.com/acme/web/pull/1#issuecomment-${id}`,
    kind: opts.kind ?? 'issue',
  };
}
