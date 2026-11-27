import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const adrDir = fileURLToPath(new URL('../adr', import.meta.url));
const adrs = readdirSync(adrDir)
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort()
  .map((f) => ({
    text: `${Number(f.slice(0, 4))}. ${f.slice(5, -3).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())}`,
    link: `/adr/${f.slice(0, -3)}`,
  }));

const repo = 'https://github.com/assuncaocharles/pinback';
const base = process.env.DOCS_BASE ?? '/pinback/';
const site = `https://assuncaocharles.github.io${base}`;
const description = 'Pin review comments to any element on a preview deployment. Comments land on the GitHub PR.';
const ogImage = `${site}og.png`;

export default defineConfig({
  title: 'pinback',
  description,
  // Served from https://<owner>.github.io/<repo>/
  base,
  lang: 'en',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: site },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#2563eb' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'pinback' }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'pinback: review comments, pinned to the page.' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: ogImage }],
  ],
  // Per-page title, description and canonical URL for link previews.
  transformHead({ pageData, title }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    const url = `${site}${path}`;
    const desc = (pageData.frontmatter.description as string | undefined) || pageData.description || description;
    const ogTitle = pageData.frontmatter.layout === 'home' ? 'pinback: review comments, pinned to the page' : title;
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: ogTitle }],
      ['meta', { property: 'og:description', content: desc }],
      ['meta', { name: 'twitter:title', content: ogTitle }],
      ['meta', { name: 'twitter:description', content: desc }],
    ];
  },
  themeConfig: {
    logo: { src: '/logo.svg', width: 24, height: 24, alt: '' },
    nav: [
      { text: 'Setup', link: '/setup' },
      { text: 'Reference', link: '/metadata-format' },
      { text: 'Decisions', link: '/adr/' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Setup', link: '/setup' },
          { text: 'Source-line comments', link: '/source-line-comments' },
          { text: 'Accessibility', link: '/accessibility' },
          { text: 'Releasing', link: '/releasing' },
        ],
      },
      { text: 'Reference', items: [{ text: 'Comment metadata format (v1)', link: '/metadata-format' }] },
      { text: 'Architecture decisions', collapsed: true, items: [{ text: 'Overview', link: '/adr/' }, ...adrs] },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    footer: { message: 'Released under the MIT License.' },
  },
});
