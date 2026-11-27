---
layout: home
title: pinback
titleTemplate: Review comments, pinned to the page

hero:
  name: pinback
  text: Review comments, pinned to the page.
  tagline: Click any element on a preview deployment, leave a comment, and it lands on the GitHub pull request. GitHub is the only database.
  actions:
    - theme: brand
      text: Set it up in 10 minutes
      link: /setup
    - theme: alt
      text: View on GitHub
      link: https://github.com/assuncaocharles/pinback

features:
  - icon: { src: /icons/code.svg, width: 28, height: 28 }
    title: One script tag
    details: A custom element in Shadow DOM. Host styles can't leak in. Under 20 kB gzipped.
  - icon: { src: /icons/database.svg, width: 28, height: 28 }
    title: GitHub is the database
    details: Every pin is a PR comment with hidden metadata. No app server, only a tiny stateless auth worker.
  - icon: { src: /icons/refresh.svg, width: 28, height: 28 }
    title: Survives redeploys
    details: Pins are matched by confidence scoring across several selectors, so renamed classes and reordered lists don't lose them.
  - icon: { src: /icons/target.svg, width: 28, height: 28 }
    title: Lands on the right line
    details: With the Vite source plugin, a pin on a component the PR changes becomes a review comment on that file and line.
  - icon: { src: /icons/shield.svg, width: 28, height: 28 }
    title: Token never reaches the page
    details: All authenticated calls happen inside an isolated auth frame. An XSS on the preview can't read the token.
  - icon: { src: /icons/access.svg, width: 28, height: 28 }
    title: Accessible
    details: Fully keyboard operable, follows the dialog pattern, and axe reports zero violations in CI.
---

<div class="pb-home">

<section class="pb-section">
  <p class="pb-eyebrow">How it works</p>
  <h2 class="pb-h2">From preview to pull request in three steps</h2>
  <ol class="pb-steps">
    <li>
      <span class="pb-step-n" aria-hidden="true"><span>1</span></span>
      <h3>Pick an element</h3>
      <p>Click <strong>Comment</strong> in the toolbar, then click the thing that looks wrong. The pin remembers it across redeploys.</p>
    </li>
    <li>
      <span class="pb-step-n" aria-hidden="true"><span>2</span></span>
      <h3>Write the comment</h3>
      <p>Markdown with live preview, and an optional screenshot of the area. Sign in with GitHub once per preview site.</p>
    </li>
    <li>
      <span class="pb-step-n" aria-hidden="true"><span>3</span></span>
      <h3>It lands on the PR</h3>
      <p>As a PR comment, or a review comment on the exact source line. Replies and resolve sync both ways.</p>
    </li>
  </ol>
</section>

<section class="pb-section">
  <p class="pb-eyebrow">Quick start</p>
  <h2 class="pb-h2">Two tags in your preview build</h2>

```html
<meta name="pinback" content="owner=ORG;repo=REPO;pr=123;sha=COMMIT_SHA;auth=https://your-auth.workers.dev">
<script src="https://unpkg.com/@assuncaocharles/pinback@0.1/dist/pinback.js" defer></script>
```

  <p class="pb-muted">Without <code>auth</code> the widget is read-only. The <a href="./setup">setup guide</a> covers the GitHub App, the one-click auth worker deploy and the CI snippet.</p>
</section>

<section class="pb-cta">
  <h2>Stop describing UI bugs in words.</h2>
  <p>Point at them. MIT licensed, free to self-host on Cloudflare's free tier.</p>
  <div class="pb-cta-actions">
    <a class="pb-btn pb-btn-brand" href="./setup">Get started</a>
    <a class="pb-btn pb-btn-alt" href="https://www.npmjs.com/package/@assuncaocharles/pinback">npm package</a>
  </div>
</section>

</div>
