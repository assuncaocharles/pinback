// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { sanitize, stripFooter } from './sanitize.js';

const html = (frag: DocumentFragment) => {
  const div = document.createElement('div');
  div.append(frag);
  return div.innerHTML;
};

describe('sanitize', () => {
  it('keeps ordinary markdown output', () => {
    const out = html(sanitize('<p>Hi <strong>there</strong> <code>x</code></p><ul><li>a</li></ul>'));
    expect(out).toBe('<p>Hi <strong>there</strong> <code>x</code></p><ul><li>a</li></ul>');
  });

  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<img src=x onerror=alert(1)>', ''],
    ['<p onclick="alert(1)" style="color:red" class="x">t</p>', '<p>t</p>'],
    ['<a href="javascript:alert(1)">x</a>', '<a target="_blank" rel="noopener noreferrer nofollow">x</a>'],
    ['<iframe src="https://evil"></iframe>', ''],
    ['<svg><script>alert(1)</script></svg>', ''],
    ['<form><input value=x></form>after', 'after'],
    ['<custom-el>text</custom-el>', 'text'],
    ['<!-- hidden --><p>v</p>', '<p>v</p>'],
  ])('neutralises %s', (input, expected) => {
    expect(html(sanitize(input))).toBe(expected);
  });

  it('hardens links and images', () => {
    const out = html(sanitize('<a href="https://x.dev/a">l</a><img src="https://img.test/a.png" alt="a">'));
    expect(out).toContain('href="https://x.dev/a"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('referrerpolicy="no-referrer"');
  });

  it('drops non-https images', () => {
    expect(html(sanitize('<img src="http://img.test/a.png">'))).toBe('');
  });

  it('removes our footer only', () => {
    const frag = sanitize(
      '<p>Real text</p><p><sub>📌 Pinned on <a href="https://p/x"><code>/x</code></a> at abc1234 · pinback</sub></p>',
    );
    expect(html(stripFooter(frag))).toBe('<p>Real text</p>');
  });

  it('also removes the pre-rename footer', () => {
    const frag = sanitize('<p>Old</p><p><sub>📌 Pinned on <code>/</code> at abc1234 · preview-pins</sub></p>');
    expect(html(stripFooter(frag))).toBe('<p>Old</p>');
  });
});

