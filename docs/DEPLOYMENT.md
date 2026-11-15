# Deployment

How Ombuto OST gets published, what was set up by hand, and how to fix it when it breaks.
Written for future agents and maintainers.

## Where it runs

| Address                                       | Host             | Role                                   |
| --------------------------------------------- | ---------------- | -------------------------------------- |
| <https://ost.francoisbotha.io/>               | Cloudflare Pages | The main address. Link to this one.    |
| <https://ombuto-ost.pages.dev/>               | Cloudflare Pages | The same deployment, Cloudflare's name |
| <https://francoisbotha.github.io/ombuto-ost/> | GitHub Pages     | A mirror                               |

The app sits on its own subdomain on purpose. Browser storage (the autosaved working copies in
IndexedDB) is per origin, so a separate origin keeps the trees apart from the owner's main site
at `francoisbotha.io`, which loads remote fonts and has a contact API. Do not move the app into a
folder of the main site.

Each address is a different origin, so each has its own autosaved working copies. A tree autosaved
at one address does not appear at another; `.ost` files work everywhere.

## Normal deploys: push to `main`

`.github/workflows/deploy.yml` runs on every push to `main` (and on manual dispatch):

1. `build` job: `npm ci`, lint, test, `npm run build`. The build fails if the built app breaks
   the privacy rules (`config/csp.ts`).
2. `cloudflare` job: `wrangler pages deploy dist --project-name ombuto-ost --branch main`.
3. `deploy` job: publishes the same `dist/` to GitHub Pages.

A small change is live about two minutes after the push. Watch it with:

```sh
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Users with the app open keep the old version until they choose Reload on the "new version"
prompt. That is deliberate (see `CLAUDE.md`).

## One-off setup already done

Nothing here needs repeating unless something is deleted.

**Cloudflare**

- Pages project `ombuto-ost`, type Direct Upload (not connected to Git), production branch `main`.
  Created with `wrangler pages project create ombuto-ost --production-branch main`.
- Custom domain `ost.francoisbotha.io` attached to the project.
- DNS record in the `francoisbotha.io` zone: `CNAME ost -> ombuto-ost.pages.dev`, proxied. This
  was added by hand in the dashboard: attaching a custom domain through the API does not create
  the record, and a `wrangler login` session cannot write DNS.

**GitHub repository `FrancoisBotha/ombuto-ost`**

- Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with one **Account** policy,
  **Cloudflare Pages: Edit**, on the account that owns the project. Nothing else is needed.
- Variable `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account id (not a secret).
- Settings > Pages > Source: "GitHub Actions".

## Deploying by hand

Only needed if the workflow is broken. Requires a `wrangler login` session on the machine.

```sh
npm run build
npx wrangler@4.80.0 pages deploy dist --project-name ombuto-ost --branch main
```

`--branch main` matters: any other branch name makes a preview deployment that the custom domain
does not serve.

## When it fails

- **`cloudflare` job: "Authentication error [code: 10000]"**. The token is missing, expired, or
  lacks Cloudflare Pages: Edit. In Cloudflare's token editor, Pages is an _Account_ permission: a
  _Zone_ policy does not list it. Fix or recreate the token, then
  `gh secret set CLOUDFLARE_API_TOKEN --repo FrancoisBotha/ombuto-ost` and re-run the failed job
  (`gh run rerun <id> --failed`).
- **`build` job fails at Build with a privacy message**. A change added a remote URL, an inline
  script or loosened the policy. Fix the change, not the check.
- **`ost.francoisbotha.io` does not resolve**. Check the CNAME record above still exists.
- **The site shows an old version after a successful run**. That is the service worker waiting
  for the user's Reload; confirm the new build with a private window.

## Related: the page about the tool

The owner's site (`C:\dev\web\francoisbotha.io`, Cloudflare Pages project `francoisbotha`) has a
Tools card and an article page at `/ost.html` that link to the app. They live in that repository
and are published separately; changing the app's address means updating them too.
