import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot, previewPinsSource, transformSource } from './index.js';

const ROOT = '/repo';
const tsx = `import { Card } from './Card';

export function App({ items }: { items: string[] }) {
  return (
    <main className="page">
      <h1>Checkout</h1>
      <Card title="x">
        <button data-testid="go" onClick={() => alert(1 as number)}>Go</button>
      </Card>
      <motion.div />
      <span data-pp-src="kept:1:1">already</span>
      <>{items.map((i) => <li key={i}>{i}</li>)}</>
    </main>
  );
}
`;

async function run(code = tsx, id = '/repo/examples/app/src/App.tsx') {
  const out = await transformSource(code, id, ROOT);
  if (!out) throw new Error('no output');
  return out.code;
}

describe('transformSource', () => {
  it('tags host elements with repo-relative path:line:col', async () => {
    const code = await run();
    expect(code).toContain('<main className="page" data-pp-src="examples/app/src/App.tsx:5:5">');
    expect(code).toContain('<h1 data-pp-src="examples/app/src/App.tsx:6:7">');
    expect(code).toContain('data-pp-src="examples/app/src/App.tsx:8:9"');
    expect(code).toContain('<li key={i} data-pp-src="examples/app/src/App.tsx:12:27">');
  });

  it('leaves components, member tags and existing attributes alone', async () => {
    const code = await run();
    expect(code).toMatch(/<Card title="x">/);
    expect(code).toContain('<motion.div />');
    expect(code).toContain('<span data-pp-src="kept:1:1">');
  });

  it('keeps TypeScript syntax and line numbers', async () => {
    const code = await run();
    expect(code).toContain('items: string[]');
    expect(code).toContain('1 as number');
    // retainLines: the <h1> is still on line 6.
    expect(code.split('\n')[5]).toContain('<h1');
  });

  it('handles .jsx without the TypeScript parser', async () => {
    const code = await run('export const A = () => <p>hi</p>;\n', '/repo/src/A.jsx');
    expect(code).toContain('data-pp-src="src/A.jsx:1:24"');
  });

  it('skips files outside the repo root and files without JSX', async () => {
    expect(await transformSource('<p/>', '/elsewhere/A.tsx', ROOT)).toBeNull();
    expect(await transformSource('export const x = 1;', '/repo/x.tsx', ROOT)).toBeNull();
  });
});

describe('findRepoRoot', () => {
  it('finds the nearest ancestor with .git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pp-'));
    mkdirSync(join(dir, '.git'));
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    expect(findRepoRoot(join(dir, 'a', 'b'))).toBe(dir);
  });
});

describe('previewPinsSource', () => {
  it('is disabled unless opted in', () => {
    const plugin = previewPinsSource({ enabled: false });
    expect(typeof plugin.apply === 'function' && plugin.apply({}, { command: 'build', mode: 'production' })).toBe(false);
  });

  it('can be enabled explicitly', () => {
    const plugin = previewPinsSource({ enabled: true });
    expect(typeof plugin.apply === 'function' && plugin.apply({}, { command: 'build', mode: 'production' })).toBe(true);
  });
});
