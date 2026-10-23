# One-time direct publishing setup for 0.91

**Normal use after setup:** Approve Clip → Publish Snippet → enter title. If not signed in, GitHub sign-in happens once; the pending snippet publishes on return. No file downloads or manual catalog editing.

## Why a Worker?
A GitHub Pages site cannot securely store a GitHub write token. The small Cloudflare Worker handles GitHub authentication, restricts publishing to your GitHub username and one repository, writes both variants and updates `snippets/index.json`. The publishing token never appears in public JS.

## Setup (one time)
1. In GitHub, create a **fine-grained personal access token** restricted to this single repository, with **Contents: Read and write**. Store it as a Cloudflare Worker **secret** named `REPO_WRITE_TOKEN`; **never** put it in public files.
2. In GitHub Developer settings, create an **OAuth App**. Its callback URL is `https://YOUR-WORKER.workers.dev/auth/callback`. Copy its Client ID and Client Secret. Store them in Cloudflare secrets `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. OAuth requests only `read:user` to verify identity; the fixed repository token performs writes.
3. Deploy the Worker from `publisher-worker/` (e.g. with Wrangler `npx wrangler deploy`). Set `GITHUB_OWNER`, `GITHUB_REPO`, `ALLOWED_GITHUB_USER`, `SITE_URL` in `wrangler.toml` first. Set the above secrets with `npx wrangler secret put SECRET_NAME` or the Cloudflare dashboard. Also create `SESSION_SECRET` as a long independent cryptographically random secret. **Do not commit any secret value.**
4. If you don't know the Worker URL before creating the GitHub OAuth App, deploy it first, then enter that URL as the app's callback and add the secrets.
5. In `publish-config.js`, set `window.LESSON_PUBLISH_API` to your Worker URL (no trailing slash). This is a public URL, *not* a secret. Upload the repository files to GitHub. Do not upload `publisher-worker/` if your GitHub Pages deployment builds from repository root and you prefer to keep backend sources separate; it contains no secrets regardless.
6. Test `https://YOUR-WORKER.workers.dev/health` for `configured:true`. In Lesson Builder, approve a simple clip, click Publish Snippet, log in to your GitHub account. The snippet and catalog should be committed automatically. GitHub Pages may take time to rebuild; reload Reader afterward.

## Security and operational notes
- Only the configured GitHub username is authorized. OAuth state checking prevents sign-in callback substitution. Short-lived signed publishing sessions are kept in memory in the page and returned via a URL fragment removed immediately after loading. They are not GitHub tokens.
- Configure the OAuth callback URL exactly as shown; ensure your Worker account and GitHub OAuth App are controlled by you.
- The Worker commits each snippet first, then the catalog. A failure between these writes can leave an unlisted snippet; report the error instead of falsely claiming success.
- For now newly published snippets use unique IDs, preventing silent overwrites. GitHub Pages is a static site: no changes become live until publication completes.
- Do not test saving from local `file://` pages; publishing is restricted to the configured GitHub Pages origin.
- The publishing UI is entirely separate from the Player runtime. Audio, animation, and original/open conversion remain unchanged.
