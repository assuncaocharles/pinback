import type { Plugin } from 'vite';

export interface PreviewPinsSourceOptions {
  /**
   * Whether to tag elements. Defaults to `process.env.PREVIEW_PINS === '1'`
   * so production builds stay untouched unless CI opts in.
   */
  enabled?: boolean;
}

/**
 * M0 skeleton: resolves the enabled flag and registers a no-op transform.
 * M4 adds the Babel pass that writes `data-pp-src="path:line:col"`.
 */
export function previewPinsSource(options: PreviewPinsSourceOptions = {}): Plugin {
  const enabled = options.enabled ?? process.env.PREVIEW_PINS === '1';
  return {
    name: 'preview-pins:source',
    enforce: 'pre',
    apply: () => enabled,
  };
}
