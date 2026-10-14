# Cloudflare Workers deployment notes

This repository's main web application is Next.js. The Cloudflare Workers path uses the OpenNext adapter.

## Cloudflare Workers Builds settings

For the existing `clottis-teams-web` Workers Builds project, use:

- Root directory: `/`
- Build command: `npm run cf-build`
- Deploy command: `npx wrangler preview` for Preview Builds only
- Build variable: `NEXT_PUBLIC_API_BASE_URL=https://team.clottis.net/api/v1`

Do not use a production deploy command until the preview is verified and a release is explicitly approved. The adapter's production command is `npm run deploy`; it is intentionally not used by this validation workflow.

## Local verification

Use Node.js 22 or newer:

```sh
npm ci
npm run lint -- --ignore-pattern 'auth-slice/**'
npm run typecheck
npm run cf-build
npm run preview
```

The CI workflow builds and previews the Worker without deploying to production.

## Boundaries

- This change does not merge PR #5 or deploy the separate `auth-slice` containers.
- Cloudflare dashboard settings and secrets are not managed by repository files alone. Confirm the dashboard commands and build variable match the settings above.
- A successful build does not prove the custom domain's TLS certificate, API routing, or production health is correct. Verify those separately before release.
