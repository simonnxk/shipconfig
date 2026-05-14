# ShipConfig

ShipConfig is a Next.js workbench for generating deploy-ready container configuration from a few structured inputs.

## Features

- Dockerfile templates for Node.js, Python FastAPI, Go APIs, and static nginx apps
- `docker-compose.yml` with ports, env vars, restart policy, and health checks
- Kubernetes Namespace, ConfigMap, Secret, Deployment, Service, and Ingress manifests
- Helm starter chart files
- GitHub Actions workflow for container build/push and Kubernetes deploy
- Copy-to-clipboard and client-side ZIP export
- Browser-first free workflow with local persistence and no stored secrets
- `/api/resolve` route for optional Auto Resolve metadata inference
- Local-first Pro Workspace layer for demo accounts, teams, saved projects, versions, diffs, presets, and review links behind provider-neutral auth/storage adapters

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production build

```bash
npm run build
npm run start
```

## Deploy

This app is Vercel-compatible with the default Next.js settings.

```bash
npx vercel pull --yes
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

## Notes

Generated secrets are placeholders. Replace them with your platform's secret manager or sealed-secret workflow before using in production.

ShipConfig sanitizes `ServiceConfig.secrets` when writing saved snapshots, Pro Workspace presets, and share/review links. Safe placeholder values such as `[DATABASE_URL_PLACEHOLDER]` are preserved; other secret values are replaced with generated placeholders.
