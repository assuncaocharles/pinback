import { describe, expect, it } from 'vitest';
import { chooseReviewTarget, commentableLines, parseSource, type PrFile } from './diff.js';

const patch = [
  '@@ -10,6 +10,7 @@ export function App() {',
  '   return (',
  '     <main>',
  '-      <h1>Old</h1>',
  '+      <h1>Checkout</h1>',
  '+      <p>New intro</p>',
  '       <section>',
  '         <ul>',
  '@@ -40,3 +41,3 @@ function Footer() {',
  '   return (',
  '-    <footer>old</footer>',
  '+    <footer>new</footer>',
  '   );',
  '\\ No newline at end of file',
].join('\n');

const files: PrFile[] = [
  { filename: 'examples/app/src/App.tsx', status: 'modified', patch },
  { filename: 'examples/app/src/logo.png', status: 'added' },
  { filename: 'examples/app/src/Gone.tsx', status: 'removed', patch: '@@ -1,1 +0,0 @@\n-x' },
];

describe('parseSource', () => {
  it('parses path:line:col', () => {
    expect(parseSource('src/App.tsx:12:5')).toEqual({ path: 'src/App.tsx', line: 12, col: 5 });
  });

  it.each(['/etc/passwd:1:1', '../up/App.tsx:1:1', 'src/../x.tsx:1:1', 'C:/x.tsx:1:1', 'src/App.tsx', 'src/App.tsx:0:1'])(
    'rejects %s',
    (s) => {
      expect(parseSource(s)).toBeNull();
    },
  );
});

describe('commentableLines', () => {
  it('lists added and context lines on the new side, skipping deletions', () => {
    expect(commentableLines(patch)).toEqual([10, 11, 12, 13, 14, 15, 41, 42, 43]);
  });
});

describe('chooseReviewTarget', () => {
  it('rule 1: the element line is in a hunk', () => {
    expect(chooseReviewTarget(files, 'examples/app/src/App.tsx:12:7')).toEqual({
      kind: 'review',
      path: 'examples/app/src/App.tsx',
      line: 12,
      exact: true,
    });
  });

  it('rule 2: nearest commentable line, earlier on ties', () => {
    expect(chooseReviewTarget(files, 'examples/app/src/App.tsx:20:3')).toMatchObject({ line: 15, exact: false });
    expect(chooseReviewTarget(files, 'examples/app/src/App.tsx:38:3')).toMatchObject({ line: 41, exact: false });
    expect(chooseReviewTarget(files, 'examples/app/src/App.tsx:28:3')).toMatchObject({ line: 15, exact: false });
  });

  it('rule 3: file not in the diff, removed, or without a patch', () => {
    expect(chooseReviewTarget(files, 'examples/app/src/Other.tsx:1:1')).toEqual({ kind: 'issue', reason: 'not-in-diff' });
    expect(chooseReviewTarget(files, 'examples/app/src/Gone.tsx:1:1')).toEqual({ kind: 'issue', reason: 'not-in-diff' });
    expect(chooseReviewTarget(files, 'examples/app/src/logo.png:1:1')).toEqual({ kind: 'issue', reason: 'no-patch' });
  });

  it('no or invalid source: plain comment', () => {
    expect(chooseReviewTarget(files, undefined)).toEqual({ kind: 'issue', reason: 'no-source' });
    expect(chooseReviewTarget(files, '../x:1:1')).toEqual({ kind: 'issue', reason: 'no-source' });
  });
});
