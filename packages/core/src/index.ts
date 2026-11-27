export type { PRContext } from './types.js';
export { BackendError, type AuthorAssociation, type Backend, type RawComment } from './backend.js';
export {
  fromMeta,
  fromQuery,
  resolvePRContext,
  resolveAuthOrigin,
  resolvePRContextFromPage,
  type PartialPRContext,
} from './context.js';
export {
  METADATA_VERSION,
  decodeMetadata,
  encodeMetadata,
  formatCommentBody,
  stripMetadata,
  type Anchor,
  type FormatOptions,
  type PinMetadata,
  type RelativePoint,
  type TextQuote,
  type ThreadState,
} from './metadata.js';
export { buildThreads, normalisePath, threadsForPath, type PinComment, type Thread } from './threads.js';
export { GitHubBackend, nextLink, type GitHubBackendOptions } from './github.js';
export {
  ANCHOR_APPROXIMATE,
  ANCHOR_THRESHOLD,
  AnchorIndex,
  cssPath,
  describeElement,
  isStableClass,
  isStableId,
  matchAnchor,
  normaliseText,
  pinPosition,
  resolveAnchor,
  similarity,
  type AnchorMatch,
  type ResolveOptions,
} from './anchor.js';
export {
  RPC_VERSION,
  isRpcEvent,
  isRpcRequest,
  isRpcResponse,
  isSealedSignIn,
  type CreateCommentParams,
  type RpcErrorCode,
  type RpcEvent,
  type RpcMethod,
  type RpcMethods,
  type RpcRequest,
  type RpcResponse,
  type SealedSignIn,
  type Viewer,
} from './rpc.js';
export {
  chooseReviewTarget,
  commentableLines,
  parseSource,
  type PrFile,
  type ReviewTarget,
  type SourceLocation,
} from './diff.js';
export type { ReviewThreadState } from './github.js';
