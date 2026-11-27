import { describe, expect, it } from 'vitest';
import { decodeMetadata, encodeMetadata, formatCommentBody, stripMetadata, type PinMetadata } from './metadata.js';

const meta: PinMetadata = {
  anchor: {
    testId: 'checkout-button',
    cssPath: 'main > section:nth-of-type(1) > button',
    textQuote: { exact: 'Place order', prefix: 'Total $62', suffix: '' },
    rect: { x: 0.5, y: 0.25 },
  },
  viewport: { w: 1440, h: 900 },
  url: '/checkout',
  sha: 'abc1234',
  parent: null,
};

describe('metadata', () => {
  it('round-trips', () => {
    expect(decodeMetadata(encodeMetadata(meta))).toEqual(meta);
  });

  it('escapes sequences that would end or nest the HTML comment', () => {
    const tricky: PinMetadata = {
      ...meta,
      anchor: { textQuote: { exact: 'a --> b --!> c <!-- d', prefix: '<', suffix: '>' } },
    };
    const encoded = encodeMetadata(tricky);
    const inner = encoded.slice('<!-- '.length, -' -->'.length);
    expect(inner).not.toMatch(/-->|--!>|<!--|<|>/);
    expect(decodeMetadata(encoded)).toEqual(tricky);
  });

  it('finds the block inside a full comment body', () => {
    const body = formatCommentBody({ text: 'The button is **too** small', meta, previewUrl: 'https://pr-1.x.dev/checkout' });
    expect(decodeMetadata(body)).toEqual(meta);
    expect(stripMetadata(body)).toContain('The button is **too** small');
    expect(stripMetadata(body)).not.toContain('preview-pins:v1');
  });

  it('uses the last block when the text quotes another pin', () => {
    const quoted = encodeMetadata({ ...meta, url: '/quoted' });
    const body = `> ${quoted}\n\nreply\n\n${encodeMetadata(meta)}`;
    expect(decodeMetadata(body)?.url).toBe('/checkout');
  });

  it.each([
    ['no block', 'just a comment'],
    ['other marker', '<!-- preview-pins:deploy -->'],
    ['future version', '<!-- preview-pins:v2 {"anchor":{}} -->'],
    ['bad json', '<!-- preview-pins:v1 {nope} -->'],
    ['array', '<!-- preview-pins:v1 [] -->'],
    ['missing viewport', '<!-- preview-pins:v1 {"anchor":{},"url":"/","sha":"a","parent":null} -->'],
    ['relative url', '<!-- preview-pins:v1 {"anchor":{},"viewport":{"w":1,"h":1},"url":"x","sha":"a","parent":null} -->'],
    ['bad parent', '<!-- preview-pins:v1 {"anchor":{},"viewport":{"w":1,"h":1},"url":"/","sha":"a","parent":"1"} -->'],
    ['bad state', '<!-- preview-pins:v1 {"anchor":{},"viewport":{"w":1,"h":1},"url":"/","sha":"a","parent":1,"state":"x"} -->'],
  ])('rejects %s', (_, body) => {
    expect(decodeMetadata(body)).toBeNull();
  });

  it('drops malformed anchor fields but keeps the pin', () => {
    const body = '<!-- preview-pins:v1 {"anchor":{"testId":5,"rect":{"x":2,"y":-1}},"viewport":{"w":1,"h":1},"url":"/","sha":"a","parent":null} -->';
    expect(decodeMetadata(body)?.anchor).toEqual({ rect: { x: 1, y: 0 } });
  });

  it('formats replies with a reply footer', () => {
    const body = formatCommentBody({ text: 'Agreed', meta: { ...meta, parent: 12 } });
    expect(body).toContain('Reply via preview-pins');
    expect(decodeMetadata(body)?.parent).toBe(12);
  });
});
