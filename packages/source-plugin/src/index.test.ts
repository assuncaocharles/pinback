import { describe, expect, it } from 'vitest';
import { previewPinsSource } from './index.js';

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
