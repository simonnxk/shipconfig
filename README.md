# ShipConfig

ShipConfig is a static Next.js web app for generating deploy-ready container configuration from a few structured inputs.

## Features

- Dockerfile templates for Node.js, Python FastAPI, Go APIs, and static nginx apps
- `docker-compose.yml` with ports, env vars, restart policy, and health checks
- Kubernetes Namespace, ConfigMap, Secret, Deployment, Service, and Ingress manifests
- Helm starter chart content
- GitHub Actions workflow for container build/push and Kubernetes deploy
- Copy-to-clipboard and client-side ZIP export
- Runs fully in the browser; no backend and no stored secrets

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
