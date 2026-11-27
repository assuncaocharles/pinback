import type { RawComment } from './backend.js';
import type { PinMetadata } from './metadata.js';
import type { PRContext } from './types.js';

/**
 * The typed postMessage protocol between the widget (host page) and the auth
 * frame (auth worker origin). Every message carries `pp: 1`. Both sides check
 * event.origin and event.source before reading a message, then validate its
 * shape with the guards below.
 */

export const RPC_VERSION = 1;

export interface Viewer {
  login: string;
  avatarUrl: string;
}

export interface CreateCommentParams {
  ctx: PRContext;
  text: string;
  meta: PinMetadata;
  /** Absolute preview URL for the footer link. */
  previewUrl?: string;
  /** For replies and state events: where the thread's root lives, so replies stay in a review thread. */
  parentKind?: 'issue' | 'review';
}

/** Method name -> [params, result]. */
export interface RpcMethods {
  /** Handshake. Pins the parent origin in the frame. */
  hello: [Record<string, never>, { viewer: Viewer | null; challenge: string }];
  /** Exchange a sealed sign-in blob for tokens (stored in the frame only). */
  redeem: [{ blob: string }, { viewer: Viewer }];
  signOut: [Record<string, never>, null];
  listComments: [{ ctx: PRContext }, RawComment[]];
  createComment: [CreateCommentParams, RawComment];
  renderMarkdown: [{ ctx: PRContext; text: string }, string];
  /** Whether the viewer may resolve threads they didn't start (push access). */
  canMaintain: [{ ctx: PRContext }, boolean];
}

export type RpcMethod = keyof RpcMethods;

export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  pp: typeof RPC_VERSION;
  id: number;
  method: M;
  params: RpcMethods[M][0];
}

export type RpcErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'http'
  | 'internal';

export type RpcResponse =
  | { pp: typeof RPC_VERSION; id: number; ok: true; result: unknown }
  | { pp: typeof RPC_VERSION; id: number; ok: false; error: { code: RpcErrorCode; message: string } };

/** Unsolicited messages from the frame. */
export interface RpcEvent {
  pp: typeof RPC_VERSION;
  event: 'auth-changed';
  viewer: Viewer | null;
  /** The frame's current sign-in challenge (rotates after every sign-in). */
  challenge: string;
}

/** Sent from the OAuth callback page to the widget (via window.opener). */
export interface SealedSignIn {
  pp: typeof RPC_VERSION;
  event: 'sealed';
  blob: string;
}

const METHODS: ReadonlySet<string> = new Set<RpcMethod>([
  'hello',
  'redeem',
  'signOut',
  'listComments',
  'createComment',
  'renderMarkdown',
  'canMaintain',
]);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isRpcRequest(data: unknown): data is RpcRequest {
  return (
    isRec(data) &&
    data.pp === RPC_VERSION &&
    typeof data.id === 'number' &&
    typeof data.method === 'string' &&
    METHODS.has(data.method) &&
    isRec(data.params)
  );
}

export function isRpcResponse(data: unknown): data is RpcResponse {
  return isRec(data) && data.pp === RPC_VERSION && typeof data.id === 'number' && typeof data.ok === 'boolean';
}

export function isRpcEvent(data: unknown): data is RpcEvent {
  return isRec(data) && data.pp === RPC_VERSION && data.event === 'auth-changed';
}

export function isSealedSignIn(data: unknown): data is SealedSignIn {
  return (
    isRec(data) &&
    data.pp === RPC_VERSION &&
    data.event === 'sealed' &&
    typeof data.blob === 'string' &&
    data.blob.length < 8192
  );
}
