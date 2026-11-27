# Setup

From a fresh repo to pins on your previews: about 10 minutes.

## 1. Add the widget to your preview builds

Add one script tag and one meta tag to the HTML your previews serve. Build
the meta tag from CI variables:

```html
<meta name="preview-pins" content="owner=ORG;repo=REPO;pr=123;sha=FULL_COMMIT_SHA;auth=https://preview-pins-auth.YOU.workers.dev">
<script src="https://unpkg.com/@preview-pins/widget/dist/preview-pins.js" defer></script>
```

- `pr` and `sha` come from the pull request (in GitHub Actions:
  `github.event.pull_request.number` and `github.event.pull_request.head.sha`).
- `auth` is your auth worker (step 3). Without it the widget is read-only.
- Without the meta tag, the widget falls back to the
  `?pp_owner=&pp_repo=&pp_pr=&pp_sha=` query params, then to
  `element.config`. `auth` is never read from the URL.

Only add the tags in preview builds. The widget does nothing useful in
production.

**Optional, recommended:** add `@preview-pins/source-plugin` to your Vite
config and build previews with `PREVIEW_PINS=1`. Pins on components the PR
changes then land as review comments on the right file and line. See
[source-line-comments.md](source-line-comments.md).

## 2. Register a GitHub App

GitHub → Settings → Developer settings → **GitHub Apps → New GitHub App**:

| Field | Value |
| --- | --- |
| Homepage URL | your repo URL |
| Callback URL | `https://preview-pins-auth.YOU.workers.dev/auth/callback` |
| Expire user authorization tokens | ✅ (the worker refreshes them) |
| Request user authorization during installation | off |
| Device flow | off |
| Webhook | **Active: off** |
| Repository permissions | **Pull requests: Read and write**, Metadata: Read-only |
| Where can it be installed | Only on this account (or any, if you'll share it) |

After creating it:

1. Copy the **Client ID**.
2. **Generate a client secret** and keep it for step 3. Don't commit it.
3. **Install the App** on the repositories whose previews will use it.
   User tokens from a GitHub App can only act on repos where the App is
   installed.

## 3. Deploy the auth worker

The worker is stateless and runs on Cloudflare's free tier. Pick one option.

### Option A: one click from GitHub Actions (recommended)

No local setup needed: everything is done in GitHub and Cloudflare settings.

1. In Cloudflare, create an API token with **Workers Scripts: Edit** and
   **Account Settings: Read** (add **Cloudflare Pages: Edit** if it also
   deploys your previews). Make sure your account has a **workers.dev
   subdomain** (Workers & Pages → overview → Subdomain).
2. In the repo, under **Settings → Secrets and variables → Actions**, add:

   | Kind | Name | Notes |
   | --- | --- | --- |
   | Secret | `CLOUDFLARE_API_TOKEN` | From step 1 |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | Shown on the Workers & Pages overview |
   | Secret | `PP_GITHUB_CLIENT_SECRET` | From the GitHub App (step 2). Optional for the first run |
   | Variable or secret | `PP_GITHUB_CLIENT_ID` | From the GitHub App. Optional for the first run |
   | Variable | `PP_ALLOWED_ORIGINS` | Default `https://*.<CF_PAGES_PROJECT>.pages.dev` |
   | Variable | `PP_ALLOWED_REPOS` | Default: this repository |
   | Secret | `PP_SESSION_KEY` | Optional. If unset, a fresh key is generated per deploy (safe: it only cancels sign-ins in progress) |

3. **Actions → Deploy auth worker → Run workflow.** The run summary prints the
   worker URL and the exact **GitHub App callback URL**.

A good order for a fresh setup: run it once to get the URL, create the
GitHub App with that callback, add the client ID and secret, then run it
again. After that, pushes to `main` that touch the worker redeploy it
automatically.

### Option B: from your machine

```sh
cd packages/auth-worker
pnpm wrangler login
pnpm wrangler secret put GITHUB_CLIENT_SECRET     # paste the client secret
openssl rand -base64 32 | pnpm wrangler secret put SESSION_KEY
pnpm vite build && pnpm wrangler deploy \
  --var GITHUB_CLIENT_ID:Iv1.xxxxxxxx \
  --var "ALLOWED_ORIGINS:https://*.your-previews.pages.dev" \
  --var ALLOWED_REPOS:your-org/your-repo
```

### Either way

- `ALLOWED_ORIGINS` lists the preview origins allowed to embed the frame and
  sign in. Use exact origins or one leading wildcard label. Nothing else is
  accepted.
- `ALLOWED_REPOS` (recommended) limits which repos the worker acts on.
- Check that it's up: `https://<worker>/health` should return `ok`.
- Then set the `PP_AUTH_ORIGIN` repository variable (or the `auth=` meta tag
  field) to the worker URL so previews enable sign-in.

### Optional: screenshots

Reviewers can attach a screenshot of the pinned area. Images are stored in
your R2 bucket and embedded in the comment. Read
[ADR 11](adr/0011-screenshots.md) first: images are public by URL, so think
twice for private repos.

1. Cloudflare → **R2** → create a bucket, e.g. `preview-pins-screenshots`.
   R2 needs a payment method on the account, even on the free tier.
   Optionally add a lifecycle rule that deletes objects after 90 days.
2. Add **Workers R2 Storage: Edit** to the Cloudflare API token.
3. Set the repository variable `PP_SCREENSHOTS_BUCKET` to the bucket name
   and run **Deploy auth worker**. Deploying locally instead: uncomment the
   `[[r2_buckets]]` block in `packages/auth-worker/wrangler.toml`.

The **Attach screenshot** checkbox then appears in the composer. Serve
`preview-pins-capture.mjs` next to `preview-pins.js` (unpkg/jsdelivr do this
automatically), or set `config.captureUrl`.

### Preview cleanup

`.github/workflows/preview-cleanup.yml` deletes a PR's Pages deployments when
the PR is closed or merged, so its `pr-<n>` URL stops serving. To remove older
previews, run it manually (Actions → Preview cleanup → Run workflow) with the
PR numbers, e.g. `1 2 3`.

## 4. Try it

Open a PR, open its preview, and click **Comment** in the toolbar. Then pick
an element, sign in with GitHub, and post. The comment appears on the PR,
and the pin appears for everyone viewing the preview.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Comment button disabled | No `auth=` in the meta tag, or no PR context. |
| Sign-in popup shows "not an allowed preview origin" | Add the preview origin to `ALLOWED_ORIGINS`. |
| Sign-in completes but posting fails with "permission" | Install the GitHub App on the repo. |
| "PR not found. Sign in for private repos" | Expected for private repos while signed out. |
| Rate limit message | Anonymous reads share 60 requests/hour per IP. Signing in raises this. |
