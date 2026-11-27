---
layout: home

hero:
  name: preview-pins
  text: Review comments, pinned to the page.
  tagline: Click any element on a preview deployment, leave a comment, and it lands on the GitHub pull request. GitHub is the only database.
  image:
    src: /demo.gif
    alt: Reviewer picks the checkout button on a preview, signs in with GitHub, posts a comment, and a numbered pin appears on the button.
  actions:
    - theme: brand
      text: Set it up in 10 minutes
      link: /setup
    - theme: alt
      text: View on GitHub
      link: https://github.com/assuncaocharles/pinback

features:
  - title: One script tag
    details: A custom element in Shadow DOM. Host styles can't leak in. Under 20 kB gzipped.
  - title: GitHub is the database
    details: Every pin is a PR comment with hidden metadata. No app server, only a tiny stateless auth worker.
  - title: Survives redeploys
    details: Pins are matched by confidence scoring across several selectors, so renamed classes and reordered lists don't lose them.
  - title: Lands on the right line
    details: With the Vite source plugin, a pin on a component the PR changes becomes a review comment on that file and line.
  - title: Token never reaches the page
    details: All authenticated calls happen inside an isolated auth frame. An XSS on the preview can't read the token.
  - title: Accessible
    details: Fully keyboard operable, follows the dialog pattern, and axe reports zero violations in CI.
---
