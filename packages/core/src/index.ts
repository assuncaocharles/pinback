export type { PRContext } from './types.js';
export { BackendError, type AuthorAssociation, type Backend, type RawComment } from './backend.js';
export {
  fromMeta,
  fromQuery,
  resolvePRContext,
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
export { cssPath, describeElement, normaliseText, pinPosition, resolveAnchor, type ResolveOptions } from './anchor.js';
