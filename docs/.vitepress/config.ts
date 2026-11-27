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

export default defineConfig({
  title: 'pinback-widget',
  description: 'Pin review comments to any element on a preview deployment. Comments land on the GitHub PR.',
  // Served from https://<owner>.github.io/<repo>/
  base: process.env.DOCS_BASE ?? '/pinback/',
  lang: 'en',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
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
