import { describe, expect, it } from 'vitest';
import { parseAllowlist } from './origins.js';

describe('parseAllowlist', () => {
  const allow = parseAllowlist('https://preview.example.com, https://*.pages.dev, http://localhost:5173');

  it.each([
    'https://preview.example.com',
    'https://PREVIEW.example.com',
    'https://pr-12.pages.dev',
    'http://localhost:5173',
  ])('allows %s', (o) => { expect(allow(o)).toBe(true); });

  it.each([
    'https://example.com',
    'http://preview.example.com',
    'https://a.b.pages.dev',
    'https://pages.dev',
    'https://evil.com/.pages.dev',
    'https://pr-12.pages.dev.attacker.io',
    'http://localhost:5174',
    'null',
    '',
    'javascript:alert(1)',
  ])('rejects %s', (o) => { expect(allow(o)).toBe(false); });

  it('rejects everything when unset', () => {
    expect(parseAllowlist(undefined)('https://example.com')).toBe(false);
  });
});
