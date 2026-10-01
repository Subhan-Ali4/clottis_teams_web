# CLOTTIS Teams Web

Next.js App Router foundation for the CLOTTIS team-delivery workspace.

## Architecture

```text
component -> executor -> service -> API
```

- `app/`: routes, layouts and route handlers.
- `components/`: reusable presentation and feature components.
- `executors/`: UI use-case orchestration.
- `services/`: network and dependency access.
- `structs/`: typed API and view contracts.
- `configs/`: validated public environment configuration.
- `utils/`: focused shared helpers and errors.
- `deploy/`: deployment-specific configuration and scripts.

## Local Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

The application expects the Rust API at `NEXT_PUBLIC_API_BASE_URL`.

Endpoints:

- `GET /api/health` - Next.js process health.
- The landing page checks backend `GET /api/v1/health`.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
docker compose config
```
