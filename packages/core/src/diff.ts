/**
 * Diff awareness for source-line comments (M4, ADR 10): given the PR's
 * changed files and a pinned element's `data-pp-src`, decide whether the pin
 * can become a review comment, and on which line.
 */

export interface PrFile {
  /** Path in the PR head (the new name for renames). */
  filename: string;
  /** GitHub's file status: added, removed, modified, renamed, copied, changed or unchanged. */
  status: string;
  /** Unified diff for the file. Absent for binary or very large files. */
  patch?: string;
}

export interface SourceLocation {
  path: string;
  line: number;
  col: number;
}

/** Parses "path:line:col". Rejects absolute paths and `..` segments. */
export function parseSource(source: string): SourceLocation | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(source);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const path = m[1];
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..')) return null;
  const line = Number(m[2]);
  const col = Number(m[3]);
  if (line < 1 || col < 1) return null;
  return { path, line, col };
}

/**
 * Lines on the new (RIGHT) side that a review comment can target: every added
 * or context line inside a hunk. Deleted lines only exist on the LEFT side.
 */
export function commentableLines(patch: string): number[] {
  const out: number[] = [];
  let next = 0;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header?.[1]) {
      next = Number(header[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    // '+' added and ' ' context lines exist on the RIGHT side. '-' (LEFT only)
    // and '\' ("No newline at end of file") don't advance the new-side count.
    const kind = raw[0];
    if (kind === '+' || kind === ' ') {
      out.push(next);
      next++;
    }
  }
  return out;
}

export type ReviewTarget =
  | { kind: 'review'; path: string; line: number; /** Whether `line` is the element's own line. */ exact: boolean }
  | { kind: 'issue'; reason: 'no-source' | 'not-in-diff' | 'no-patch' | 'no-hunks' };

/**
 * Fallback rules (docs/source-line-comments.md):
 * 1. The file is in the diff and the element's line is in a hunk: comment on that line.
 * 2. The file is in the diff with hunks, but not at that line: comment on the
 *    nearest commentable line (ties go to the earlier line), noting the real line.
 * 3. The file isn't in the diff, was removed, or has no patch: plain PR comment.
 * (4. If GitHub rejects the review comment, the caller posts a plain PR comment.)
 */
export function chooseReviewTarget(files: readonly PrFile[], source: string | undefined): ReviewTarget {
  const loc = source ? parseSource(source) : null;
  if (!loc) return { kind: 'issue', reason: 'no-source' };
  const file = files.find((f) => f.filename === loc.path && f.status !== 'removed');
  if (!file) return { kind: 'issue', reason: 'not-in-diff' };
  if (!file.patch) return { kind: 'issue', reason: 'no-patch' };
  const lines = commentableLines(file.patch);
  if (!lines.length) return { kind: 'issue', reason: 'no-hunks' };
  if (lines.includes(loc.line)) return { kind: 'review', path: loc.path, line: loc.line, exact: true };
  let best = lines[0] ?? loc.line;
  for (const l of lines) {
    if (Math.abs(l - loc.line) < Math.abs(best - loc.line)) best = l;
  }
  return { kind: 'review', path: loc.path, line: best, exact: false };
}
