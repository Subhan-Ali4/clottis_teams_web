# Authentication slice production deployment preparation

This directory is a separate React/Vite + Express/SQLite application. These container files make the two components buildable, but do not deploy them or change the existing Next.js production service.

## Proposed isolation

Use a dedicated hostname such as `auth.team.clottis.net` for the authentication UI and its same-origin `/api` requests. Before enabling it, an administrator must:
1. Create/verify the DNS record for the chosen hostname and configure HTTPS in the existing Nginx/ACME setup.
2. Configure the host reverse proxy so `/` goes to the auth frontend container and `/api/` goes to the auth backend container. Keep both upstreams bound to localhost or a private Docker network; do not publish the API directly to the public internet.
3. Persist the backend's `/data` directory on a dedicated host volume. The backend uses `DB_FILE=/data/auth.sqlite`; do not use an ephemeral container filesystem for SQLite.
4. Set `NODE_ENV=production` and securely provide the initial Owner's name, email, and password only for a one-time seed operation. Do not commit secrets or run the seed script on every restart.
5. Confirm backup/restore for the SQLite database, file ownership for the mounted volume, cookie security over HTTPS, and API readiness before routing traffic.

## Build and local smoke test

From the repository root:

```sh
docker build -t clottis-auth-api:local -f auth-slice/backend/Dockerfile auth-slice/backend
docker build -t clottis-auth-web:local -f auth-slice/frontend/Dockerfile auth-slice/frontend
```

Run containers on a private network with a persistent volume and test login/logout, session persistence, role checks, password reset/change, account deactivation, and restart persistence before any production rollout.

## Deployment status

Preparation only. No production workflow is enabled for these images, no server/Nginx/DNS changes are made by these files, and the existing Next.js deployment workflow remains unchanged. Do not route real users to the auth slice until the host, TLS, persistence, seed process, and rollback procedure have been verified.
