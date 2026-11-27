import type { AuthorAssociation, RawComment } from './backend.js';
import { decodeMetadata, stripMetadata, type PinMetadata, type ThreadState } from './metadata.js';

export interface PinComment {
  id: string;
  /** Where it lives on GitHub: PR conversation or a diff-line review thread. */
  kind: RawComment['kind'];
  author: RawComment['author'];
  createdAt: string;
  htmlUrl: string;
  bodyHtml: string;
  /** Markdown without the metadata block. */
  text: string;
  meta: PinMetadata;
}

export interface Thread {
  id: string;
  /** 1-based, stable for the PR: roots numbered by creation time. */
  number: number;
  root: PinComment;
  /** Conversation replies, oldest first. State-change events are not included. */
  replies: PinComment[];
  state: ThreadState;
  /** Who last changed the state, if anyone did. */
  stateChangedBy?: string;
}

/** Associations that may resolve or reopen any thread. The root's author always may. */
const MAINTAINERS: ReadonlySet<AuthorAssociation> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * Turns a flat list of PR comments into threads.
 * - Comments without valid metadata are ignored (ordinary PR discussion).
 * - Replies point at their root via meta.parent. Replies to unknown roots are dropped.
 * - A reply with meta.state is a state event. The latest event from an
 *   authorised user wins (ADR 5); events from others are ignored.
 */
export function buildThreads(comments: readonly RawComment[]): Thread[] {
  const pins: PinComment[] = [];
  const nativeReplies: RawComment[] = [];
  const resolvedOnGitHub = new Map<string, boolean>();
  for (const c of comments) {
    if (c.threadResolved !== undefined) resolvedOnGitHub.set(c.id, c.threadResolved);
    const meta = decodeMetadata(c.body);
    if (!meta) {
      // Replies typed in GitHub's own review UI carry no metadata; attach
      // them to their thread below via in_reply_to.
      if (c.kind === 'review' && c.inReplyTo) nativeReplies.push(c);
      continue;
    }
    pins.push({
      id: c.id,
      kind: c.kind,
      author: c.author,
      createdAt: c.createdAt,
      htmlUrl: c.htmlUrl,
      bodyHtml: c.bodyHtml,
      text: stripMetadata(c.body),
      meta,
    });
  }
  pins.sort(byCreated);

  const threads = new Map<string, Thread>();
  let n = 0;
  for (const pin of pins) {
    if (pin.meta.parent === null) {
      threads.set(pin.id, { id: pin.id, number: ++n, root: pin, replies: [], state: 'open' });
    }
  }

  for (const c of nativeReplies) {
    const thread = threads.get(c.inReplyTo ?? '');
    if (!thread) continue;
    thread.replies.push({
      id: c.id,
      kind: c.kind,
      author: c.author,
      createdAt: c.createdAt,
      htmlUrl: c.htmlUrl,
      bodyHtml: c.bodyHtml,
      text: c.body,
      meta: { ...thread.root.meta, anchor: {}, parent: Number(thread.id) },
    });
  }

  for (const pin of pins) {
    if (pin.meta.parent === null) continue;
    const thread = threads.get(String(pin.meta.parent));
    if (!thread) continue;
    if (pin.meta.state) {
      const allowed = MAINTAINERS.has(pin.author.association) || pin.author.login === thread.root.author.login;
      if (allowed) {
        thread.state = pin.meta.state;
        thread.stateChangedBy = pin.author.login;
      }
      // A state event may carry a note ("Fixed in abc123"); show it as a reply.
      if (pin.text.replace(/<sub>[\s\S]*?<\/sub>/g, '').trim()) thread.replies.push(pin);
      continue;
    }
    thread.replies.push(pin);
  }

  // GitHub's resolved state is authoritative for review threads when known.
  for (const thread of threads.values()) {
    const resolved = resolvedOnGitHub.get(thread.id);
    if (resolved !== undefined) thread.state = resolved ? 'resolved' : 'open';
    thread.replies.sort(byCreated);
  }

  return [...threads.values()];
}

function byCreated(a: PinComment, b: PinComment): number {
  return a.createdAt.localeCompare(b.createdAt) || Number(a.id) - Number(b.id);
}

/** Normalises a pathname so "/checkout/" and "/checkout" compare equal. */
export function normalisePath(path: string): string {
  const p = path.split(/[?#]/)[0] ?? '/';
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
}

export function threadsForPath(threads: readonly Thread[], pathname: string): Thread[] {
  const target = normalisePath(pathname);
  return threads.filter((t) => normalisePath(t.root.meta.url) === target);
}
