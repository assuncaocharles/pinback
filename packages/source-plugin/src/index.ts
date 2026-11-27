import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { transformAsync, types as t, type PluginObject } from '@babel/core';
import type { Plugin } from 'vite';

export const ATTRIBUTE = 'data-pp-src';

export interface PinbackSourceOptions {
  /**
   * Whether to tag elements. Defaults to `process.env.PREVIEW_PINS === '1'`
   * so production builds stay untouched unless CI opts in.
   */
  enabled?: boolean;
  /**
   * Directory paths are relative to. Must be the git repository root so paths
   * match the PR diff. Defaults to the nearest ancestor of the Vite root
   * containing `.git`.
   */
  repoRoot?: string;
  /** Files to transform. Default: .jsx and .tsx outside node_modules. */
  include?: RegExp;
}

const DEFAULT_INCLUDE = /\.[jt]sx$/;

/** Nearest ancestor (inclusive) containing `.git` (a directory, or a file for worktrees). */
export function findRepoRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Babel plugin: adds data-pp-src="path:line:col" to every host JSX element. */
export function tagJsx(relPath: string): PluginObject {
  return {
    name: 'pinback-source',
    visitor: {
      JSXOpeningElement(path) {
        const { node } = path;
        // Only intrinsic elements (<div>, <button>): components may not forward
        // unknown props to the DOM, and member tags (<motion.div>) are components.
        if (node.name.type !== 'JSXIdentifier' || !/^[a-z]/.test(node.name.name)) return;
        const has = node.attributes.some(
          (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === ATTRIBUTE,
        );
        if (has || !node.loc) return;
        const { line, column } = node.loc.start;
        node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier(ATTRIBUTE), t.stringLiteral(`${relPath}:${line}:${column + 1}`)),
        );
      },
    },
  };
}

/** Transforms one module's source; returns null when there's nothing to tag. */
export async function transformSource(
  code: string,
  id: string,
  repoRoot: string,
): Promise<{ code: string; map: unknown } | null> {
  if (!code.includes('<')) return null;
  const relPath = relative(repoRoot, id).split(sep).join('/');
  if (relPath.startsWith('..') || isAbsolute(relPath)) return null;
  const result = await transformAsync(code, {
    filename: id,
    babelrc: false,
    configFile: false,
    // Keep line numbers stable for later transforms and source maps.
    retainLines: true,
    sourceMaps: true,
    parserOpts: { plugins: id.endsWith('.tsx') ? ['jsx', 'typescript'] : ['jsx'] },
    plugins: [() => tagJsx(relPath)],
  });
  if (!result?.code) return null;
  return { code: result.code, map: result.map ?? null };
}

/**
 * Vite plugin: in preview builds, tags host JSX elements with
 * `data-pp-src="path:line:col"` (repo-relative) so a pin can become a review
 * comment on the right file and line (M4, ADR 10). Runs before the JSX
 * transform. Does nothing unless enabled.
 */
export function pinbackSource(options: PinbackSourceOptions = {}): Plugin {
  const enabled = options.enabled ?? process.env.PREVIEW_PINS === '1';
  const include = options.include ?? DEFAULT_INCLUDE;
  let repoRoot = options.repoRoot ? resolve(options.repoRoot) : '';

  return {
    name: 'pinback:source',
    enforce: 'pre',
    apply: () => enabled,
    configResolved(config) {
      if (!repoRoot) repoRoot = findRepoRoot(config.root) ?? config.root;
    },
    async transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!include.test(file) || file.includes('/node_modules/')) return null;
      const out = await transformSource(code, file, repoRoot);
      return out ? { code: out.code, map: out.map as never } : null;
    },
  };
}
