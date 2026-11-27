#!/usr/bin/env node
// Renders the docs social card (docs/public/og.png, 1200x630) with Playwright.
// Re-run after changing the copy: node scripts/og-image.mjs
// (needs `pnpm exec playwright install chromium`, or PW_CHROMIUM=/path/to/chrome)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const out = fileURLToPath(new URL('../docs/public/og.png', import.meta.url));
const logo = readFileSync(new URL('../docs/public/logo.svg', import.meta.url), 'utf8');

const html = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    font-family: Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #e2e8f0;
    background:
      radial-gradient(700px 420px at 92% 10%, rgba(139, 92, 246, .45), transparent 70%),
      radial-gradient(600px 400px at 0% 100%, rgba(59, 130, 246, .35), transparent 70%),
      #0b1020;
    position: relative;
  }
  .grid {
    position: absolute; inset: 0; opacity: .35;
    background-image:
      linear-gradient(rgba(148,163,184,.12) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148,163,184,.12) 1px, transparent 1px);
    background-size: 40px 40px;
    mask-image: radial-gradient(800px 500px at 30% 50%, #000, transparent 80%);
  }
  .left { position: absolute; left: 80px; top: 92px; width: 560px; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand svg { width: 64px; height: 64px; }
  .brand span { font-size: 56px; font-weight: 800; letter-spacing: -.03em; color: #fff; }
  h1 {
    margin-top: 40px; font-size: 62px; line-height: 1.06; font-weight: 800; letter-spacing: -.035em;
    background: linear-gradient(120deg, #fff 30%, #c4b5fd); -webkit-background-clip: text; color: transparent;
  }
  p { margin-top: 26px; font-size: 26px; line-height: 1.45; color: #a5b4cf; }
  .foot { position: absolute; left: 80px; bottom: 64px; display: flex; gap: 14px; }
  .chip {
    padding: 10px 18px; border-radius: 999px; font-size: 20px; font-weight: 600;
    border: 1px solid rgba(148,163,184,.3); background: rgba(15,23,42,.6); color: #cbd5e1;
  }

  /* Mock preview window on the right. */
  .win {
    position: absolute; right: -40px; top: 120px; width: 520px; height: 400px;
    border-radius: 18px; background: #f8fafc; color: #0f172a;
    box-shadow: 0 40px 80px -20px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.08);
    overflow: hidden;
  }
  .bar { height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 16px; background: #e2e8f0; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; background: #94a3b8; display: block; }
  .bar b { margin-left: 10px; flex: 1; height: 24px; border-radius: 6px; background: #fff; font: 500 13px/24px ui-monospace, monospace; color: #64748b; padding-left: 10px; }
  .page { padding: 28px 32px; }
  .line { height: 14px; border-radius: 7px; background: #e2e8f0; margin-bottom: 12px; }
  .row { padding-right: 60px; display: flex; justify-content: space-between; align-items: center; margin: 22px 0 26px; font-size: 20px; font-weight: 700; }
  .btn {
    position: relative; display: inline-block; padding: 16px 30px; border-radius: 12px;
    background: #2563eb; color: #fff; font-size: 20px; font-weight: 700;
    outline: 3px solid #8b5cf6; outline-offset: 4px;
  }
  .pin {
    position: absolute; right: -22px; top: -26px; width: 40px; height: 40px;
    border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
    background: linear-gradient(120deg, #3b82f6, #8b5cf6); box-shadow: 0 6px 16px rgba(37,99,235,.45);
    display: grid; place-items: center; border: 3px solid #fff;
  }
  .pin span { transform: rotate(45deg); font-size: 17px; font-weight: 800; color: #fff; }
  .bubble {
    position: absolute; right: 26px; top: 240px; width: 290px; padding: 16px 18px; border-radius: 14px;
    background: #fff; box-shadow: 0 18px 40px -10px rgba(15,23,42,.35), 0 0 0 1px rgba(15,23,42,.06);
    font-size: 17px; line-height: 1.4;
  }
  .who { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-weight: 700; font-size: 15px; color: #334155; }
  .av { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b, #ef4444); }
</style></head><body>
  <div class="grid"></div>
  <div class="left">
    <div class="brand">${logo}<span>pinback</span></div>
    <h1>Review comments, pinned to the page.</h1>
    <p>Click any element on a preview deployment. The comment lands on the GitHub pull request.</p>
  </div>
  <div class="foot"><span class="chip">One script tag</span><span class="chip">GitHub is the database</span><span class="chip">MIT</span></div>
  <div class="win">
    <div class="bar"><i></i><i></i><i></i><b>pr-42.your-app.pages.dev</b></div>
    <div class="page">
      <div class="line" style="width:60%"></div>
      <div class="line" style="width:85%"></div>
      <div class="row"><span>Total</span><span>$62.00</span></div>
      <span class="btn">Place order<span class="pin"><span>1</span></span></span>
    </div>
    <div class="bubble"><div class="who"><span class="av"></span>reviewer</div>Make this button full width on mobile?</div>
  </div>
</body></html>`;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: out, type: 'png' });
await browser.close();
console.log(`wrote ${out}`);
