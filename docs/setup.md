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

- `ALLOWED_ORIGINS` lists the preview origins allowed to embed the frame and
  sign in. Use exact origins or one leading wildcard label. Nothing else is
  accepted.
- `ALLOWED_REPOS` (optional, recommended) lists the repos the worker will
  act on.
- The worker stores nothing. Rotating `SESSION_KEY` only cancels sign-ins
  that are in progress.

Check that it's up: `curl https://preview-pins-auth.YOU.workers.dev/health`
should return `ok`.

### Deploying from CI instead (no local machine needed)

`.github/workflows/deploy-worker.yml` deploys the worker on demand
(Actions → Deploy auth worker → Run workflow) and on pushes to `main` that
touch it. Everything is set in the repo's GitHub settings:

| Kind | Name | Notes |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Needs **Workers Scripts: Edit** and **Account Settings: Read** (on top of Pages: Edit for previews) |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | |
| Secret | `PP_GITHUB_CLIENT_SECRET` | From the GitHub App. Optional for the first deploy |
| Secret | `PP_SESSION_KEY` | Optional. If unset, a fresh key is generated per deploy (safe: it only cancels sign-ins in progress) |
| Variable | `PP_GITHUB_CLIENT_ID` | From the GitHub App. Optional for the first deploy |
| Variable | `PP_ALLOWED_ORIGINS` | Default `https://*.<CF_PAGES_PROJECT>.pages.dev` |
| Variable | `PP_ALLOWED_REPOS` | Default: this repository |

The run summary prints the worker URL and the GitHub App callback URL. A
good order is: deploy once to get the URL, create the GitHub App with that
callback, add `PP_GITHUB_CLIENT_ID` and `PP_GITHUB_CLIENT_SECRET`, then run
the workflow again.

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
