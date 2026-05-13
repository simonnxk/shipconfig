"use client";

import JSZip from "jszip";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  GitBranch,
  Layers3,
  Loader2,
  Search,
  Server,
  Settings2,
  Share2,
  TerminalSquare,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Preset = "node" | "python" | "go" | "static";
type Tab = "dockerfile" | "compose" | "kubernetes" | "helm" | "actions" | "testDeploy" | "readme";
type Mode = "manual" | "auto";
type ResolveStatus = "idle" | "loading" | "success" | "error";
type ResolveTarget = "docker" | "kubernetes" | "compose" | "helm" | "github-actions" | "runtime";
type CheckSeverity = "pass" | "warn" | "fail";

type FormState = {
  preset: Preset;
  appName: string;
  image: string;
  registry: string;
  namespace: string;
  port: number;
  replicas: number;
  ingressHost: string;
  healthPath: string;
  envVars: string;
  secrets: string;
  cpu: string;
  memory: string;
};

type ResolveSuggestion = {
  appName: string;
  image: string;
  registry: string;
  port: number;
  healthPath: string;
  envVars: string;
  secrets: string;
  source: string;
  confidence: number;
  description: string;
  preset?: Preset;
  namespace?: string;
  replicas?: number;
  cpu?: string;
  memory?: string;
  ingressHost?: string;
};

type ResolveResponse = {
  target: ResolveTarget;
  query: string;
  suggestion: ResolveSuggestion;
};

type PreflightCheck = {
  label: string;
  message: string;
  severity: CheckSeverity;
};

type PreflightSummary = Record<CheckSeverity, number>;

type PersistedState = {
  version: 1;
  form: FormState;
  mode: Mode;
  resolveTarget: ResolveTarget;
  resolveQuery: string;
};

const presets: Record<Preset, Partial<FormState> & { label: string; description: string }> = {
  node: {
    label: "Node.js API",
    description: "Express, Fastify, Next custom server, or Nest-style services.",
    appName: "node-api",
    image: "node-api:latest",
    port: 3000,
    healthPath: "/health",
    envVars: "NODE_ENV=production\nLOG_LEVEL=info",
  },
  python: {
    label: "Python FastAPI",
    description: "Uvicorn/Gunicorn API containers with a simple health route.",
    appName: "fastapi-service",
    image: "fastapi-service:latest",
    port: 8000,
    healthPath: "/healthz",
    envVars: "PYTHONUNBUFFERED=1\nAPP_ENV=production",
  },
  go: {
    label: "Go API",
    description: "Small static binaries, minimal images and predictable ports.",
    appName: "go-api",
    image: "go-api:latest",
    port: 8080,
    healthPath: "/ready",
    envVars: "GIN_MODE=release\nLOG_LEVEL=info",
  },
  static: {
    label: "Static nginx",
    description: "Static sites and SPAs served through nginx.",
    appName: "static-site",
    image: "static-site:latest",
    port: 80,
    healthPath: "/",
    envVars: "CACHE_CONTROL=max-age=3600",
  },
};

const initial: FormState = {
  preset: "node",
  appName: "node-api",
  image: "node-api:latest",
  registry: "ghcr.io/acme",
  namespace: "production",
  port: 3000,
  replicas: 3,
  ingressHost: "api.example.com",
  healthPath: "/health",
  envVars: "NODE_ENV=production\nLOG_LEVEL=info",
  secrets: "DATABASE_URL=[DATABASE_URL_PLACEHOLDER]\nJWT_SECRET=[JWT_SECRET_PLACEHOLDER]",
  cpu: "500m",
  memory: "512Mi",
};

const STORAGE_KEY = "shipconfig.workbench.v1";
const SHARE_PARAM = "shipconfig";
const presetValues: Preset[] = ["node", "python", "go", "static"];
const modeValues: Mode[] = ["manual", "auto"];
const resolveTargetValues: ResolveTarget[] = ["docker", "kubernetes", "compose", "helm", "github-actions", "runtime"];

const tabs: { id: Tab; label: string }[] = [
  { id: "dockerfile", label: "Dockerfile" },
  { id: "compose", label: "docker-compose.yml" },
  { id: "kubernetes", label: "k8s.yaml" },
  { id: "helm", label: "helm/" },
  { id: "actions", label: ".github/workflows/deploy.yml" },
  { id: "testDeploy", label: "test-deploy.sh" },
  { id: "readme", label: "README.md" },
];

const resolveTargets: Record<ResolveTarget, { label: string; helper: string; sourceLabel: string }> = {
  docker: {
    label: "Docker image",
    helper: "Auto Resolve uses curated image templates plus public Docker Hub metadata; verify before production.",
    sourceLabel: "Image source",
  },
  kubernetes: {
    label: "Kubernetes workload",
    helper: "Auto Resolve uses curated Kubernetes profiles plus public image metadata; verify before production.",
    sourceLabel: "Kubernetes source",
  },
  compose: {
    label: "Compose stack",
    helper: "Auto Resolve favors local Docker Compose validation defaults with one replica and localhost-style settings.",
    sourceLabel: "Compose source",
  },
  helm: {
    label: "Helm starter",
    helper: "Auto Resolve shapes values.yaml and chart starter defaults for Kubernetes deployment.",
    sourceLabel: "Helm source",
  },
  "github-actions": {
    label: "GitHub Actions",
    helper: "Auto Resolve prepares CI/CD defaults for build, push, and deploy workflows.",
    sourceLabel: "Workflow source",
  },
  runtime: {
    label: "Runtime/package",
    helper: "Auto Resolve infers Node, Python, Go, or static starter defaults from the app query.",
    sourceLabel: "Runtime source",
  },
};

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "app";
}

function parsePairs(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return { key: key.trim(), value: rest.join("=").trim() };
    })
    .filter((pair) => pair.key);
}

function hasLatestTag(image: string) {
  const clean = image.trim();
  if (!clean || clean.endsWith(":latest")) {
    return true;
  }

  const lastSegment = clean.split("/").at(-1) ?? "";
  return !lastSegment.includes(":");
}

function coerceString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function coerceNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function coerceFormState(value: unknown): FormState | null {
  if (!isRecord(value)) {
    return null;
  }

  const preset = presetValues.includes(value.preset as Preset) ? (value.preset as Preset) : initial.preset;

  return {
    preset,
    appName: coerceString(value.appName, initial.appName),
    image: coerceString(value.image, initial.image),
    registry: coerceString(value.registry, initial.registry),
    namespace: coerceString(value.namespace, initial.namespace),
    port: coerceNumber(value.port, initial.port),
    replicas: coerceNumber(value.replicas, initial.replicas),
    ingressHost: coerceString(value.ingressHost, initial.ingressHost),
    healthPath: coerceString(value.healthPath, initial.healthPath),
    envVars: coerceString(value.envVars, initial.envVars),
    secrets: coerceString(value.secrets, initial.secrets),
    cpu: coerceString(value.cpu, initial.cpu),
    memory: coerceString(value.memory, initial.memory),
  };
}

function parsePersistedState(raw: string | null): PersistedState | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const form = coerceFormState(parsed.form);
    if (!form) {
      return null;
    }

    return {
      version: 1,
      form,
      mode: modeValues.includes(parsed.mode as Mode) ? (parsed.mode as Mode) : "manual",
      resolveTarget: resolveTargetValues.includes(parsed.resolveTarget as ResolveTarget)
        ? (parsed.resolveTarget as ResolveTarget)
        : "docker",
      resolveQuery: coerceString(parsed.resolveQuery, ""),
    };
  } catch {
    return null;
  }
}

function parseSharedState() {
  if (typeof window === "undefined") {
    return null;
  }

  const queryValue = new URLSearchParams(window.location.search).get(SHARE_PARAM);
  const hashValue = new URLSearchParams(window.location.hash.replace(/^#/, "")).get(SHARE_PARAM);
  const encoded = queryValue || hashValue;
  if (!encoded) {
    return null;
  }

  const parsed = parsePersistedState(encoded);
  if (parsed) {
    return parsed;
  }

  try {
    return parsePersistedState(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function imageWithPinnedPlaceholder(image: string) {
  const clean = image.trim();
  if (!clean) {
    return image;
  }

  const lastSegment = clean.split("/").at(-1) ?? clean;
  if (clean.endsWith(":latest")) {
    return `${clean.slice(0, -"latest".length)}1.0.0`;
  }

  return lastSegment.includes(":") ? clean : `${clean}:1.0.0`;
}

function placeholderTokenFor(key: string) {
  const token = key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "SECRET";
  return `[${token}_PLACEHOLDER]`;
}

function replacePlaceholderSecrets(value: string) {
  return value
    .split("\n")
    .map((line) => {
      const [key, ...rest] = line.split("=");
      if (!key || !rest.length) {
        return line;
      }

      const secretValue = rest.join("=").trim();
      return /change-me|changeme|replace-me|todo/i.test(secretValue) ? `${key.trim()}=${placeholderTokenFor(key)}` : line;
    })
    .join("\n");
}

function isStatefulNonHttpWorkload(form: FormState) {
  const fingerprint = `${form.appName} ${form.image}`.toLowerCase();
  return fingerprint.includes("redis") || fingerprint.includes("postgres") || fingerprint.includes("postgresql") || form.port === 6379 || form.port === 5432;
}

function buildPreflightChecks(form: FormState): PreflightCheck[] {
  const requiredFields = [
    form.appName.trim(),
    form.image.trim(),
    form.registry.trim(),
    form.namespace.trim(),
    form.healthPath.trim(),
  ];
  const secrets = parsePairs(form.secrets);
  const hasSecretPlaceholders = secrets.some((pair) => /change-me|changeme|replace-me|todo/i.test(pair.value));
  const hasResources = Boolean(form.cpu.trim() && form.memory.trim());
  const ingressHost = form.ingressHost.trim();
  const replicasSane = Number.isFinite(form.replicas) && form.replicas >= 1 && form.replicas <= 10;
  const portSane = Number.isFinite(form.port) && form.port > 0 && form.port <= 65535;
  const healthPathLooksHttp = form.healthPath.trim().startsWith("/");

  return [
    {
      label: "Required fields",
      severity: requiredFields.every(Boolean) && portSane ? "pass" : "fail",
      message: requiredFields.every(Boolean) && portSane ? "Core runtime fields are present." : "App, image, registry, namespace, health path, and a valid port are required.",
    },
    {
      label: "Secret placeholders",
      severity: hasSecretPlaceholders ? "warn" : "pass",
      message: hasSecretPlaceholders ? "One or more secrets still use change-me style placeholders." : "No obvious placeholder secrets detected.",
    },
    {
      label: "HTTP probes",
      severity: isStatefulNonHttpWorkload(form) && healthPathLooksHttp ? "warn" : healthPathLooksHttp ? "pass" : "fail",
      message:
        isStatefulNonHttpWorkload(form) && healthPathLooksHttp
          ? "Redis/Postgres-style workloads usually need TCP or command probes instead of HTTP probes."
          : healthPathLooksHttp
            ? "Health path is shaped like an HTTP endpoint."
            : "Health path should start with / for the generated HTTP probes.",
    },
    {
      label: "Image tag",
      severity: hasLatestTag(form.image) ? "warn" : "pass",
      message: hasLatestTag(form.image) ? "Pin an immutable image tag before production deployment." : "Image tag is pinned.",
    },
    {
      label: "Resources",
      severity: hasResources ? "pass" : "warn",
      message: hasResources ? "CPU and memory requests/limits are present." : "CPU and memory values should be set for Kubernetes.",
    },
    {
      label: "Ingress domain",
      severity: ingressHost.includes(".") ? "pass" : "warn",
      message: ingressHost.includes(".") ? "Ingress host looks like a DNS name." : "Ingress host should be a real domain before exposing traffic.",
    },
    {
      label: "Replicas",
      severity: replicasSane ? "pass" : "warn",
      message: replicasSane ? "Replica count is in a normal smoke-test range." : "Use at least 1 replica and review high counts before testing.",
    },
  ];
}

function summarizeChecks(checks: PreflightCheck[]): PreflightSummary {
  return checks.reduce<PreflightSummary>(
    (summary, check) => {
      summary[check.severity] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function dockerfileFor(preset: Preset, port: number) {
  if (preset === "python") {
    return `FROM python:3.12-slim AS runtime\nWORKDIR /app\nENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1\nCOPY requirements.txt ./\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE ${port}\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${port}"]\n`;
  }
  if (preset === "go") {
    return `FROM golang:1.23-alpine AS builder\nWORKDIR /src\nCOPY go.mod go.sum ./\nRUN go mod download\nCOPY . .\nRUN CGO_ENABLED=0 GOOS=linux go build -o /bin/server ./cmd/server\n\nFROM alpine:3.20\nRUN adduser -D appuser\nUSER appuser\nCOPY --from=builder /bin/server /server\nEXPOSE ${port}\nCMD ["/server"]\n`;
  }
  if (preset === "static") {
    return `FROM node:22-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:1.27-alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\nEXPOSE ${port}\nCMD ["nginx", "-g", "daemon off;"]\n`;
  }
  return `FROM node:22-alpine AS deps\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\n\nFROM node:22-alpine AS runtime\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nEXPOSE ${port}\nCMD ["npm", "start"]\n`;
}

function testDeployScriptFor(form: FormState) {
  const name = slug(form.appName);
  const smokeNamespace = `shipconfig-smoke-${name}`;
  const healthPath = form.healthPath.startsWith("/") ? form.healthPath : `/${form.healthPath}`;

  return `#!/usr/bin/env bash
set -euo pipefail

# ShipConfig no-side-effect validation plan for ${name}.
# Run this from the directory containing Dockerfile, docker-compose.yml, and k8s.yaml.
# The default commands validate syntax and perform Kubernetes dry-runs only.
# Smoke commands use a temporary namespace (${smokeNamespace}) and are opt-in.

APP_NAME="${name}"
SMOKE_NAMESPACE="${smokeNamespace}"
APP_PORT="${form.port}"
HEALTH_PATH="${healthPath}"

echo "== Docker Compose validation =="
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml config

echo "== Kubernetes client-side dry-run =="
kubectl apply --dry-run=client -f k8s.yaml

echo "== Kubernetes server-side dry-run =="
kubectl create namespace "$SMOKE_NAMESPACE" --dry-run=client -o yaml | kubectl apply --dry-run=server -f -
sed "s/namespace: ${form.namespace}/namespace: $SMOKE_NAMESPACE/g; s/name: ${form.namespace}/name: $SMOKE_NAMESPACE/g" k8s.yaml | kubectl apply --dry-run=server -f -

cat <<NEXT_STEPS

Optional local cluster smoke test:
  kind create cluster --name shipconfig-smoke
  # or start minikube:
  # minikube start

  kubectl create namespace "$SMOKE_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
  sed "s/namespace: ${form.namespace}/namespace: $SMOKE_NAMESPACE/g; s/name: ${form.namespace}/name: $SMOKE_NAMESPACE/g" k8s.yaml | kubectl apply -f -
  kubectl -n "$SMOKE_NAMESPACE" rollout status "deployment/$APP_NAME" --timeout=120s
  kubectl -n "$SMOKE_NAMESPACE" port-forward "svc/$APP_NAME" "8080:80"
  curl -fsS "http://127.0.0.1:8080$HEALTH_PATH"

Cleanup:
  kubectl delete namespace "$SMOKE_NAMESPACE" --ignore-not-found
  kind delete cluster --name shipconfig-smoke

Notes:
  - This script intentionally does not apply to the configured namespace by default.
  - Server dry-run requires access to a Kubernetes API server.
  - Review Secret placeholders and HTTP probes before using any real environment.
NEXT_STEPS
`;
}

function markdownValue(value: string | number) {
  return String(value).replaceAll("`", "'");
}

function readmeFor(form: FormState, image: string) {
  const name = slug(form.appName);
  const healthPath = form.healthPath.startsWith("/") ? form.healthPath : `/${form.healthPath}`;
  const smokeNamespace = `shipconfig-smoke-${name}`;
  const envNames = parsePairs(form.envVars).map((pair) => pair.key);
  const secretNames = parsePairs(form.secrets).map((pair) => pair.key);

  return `# ${name}

Generated by ShipConfig for \`${markdownValue(form.appName)}\`.

## App and Config Summary

| Setting | Value |
| --- | --- |
| App name | \`${markdownValue(form.appName)}\` |
| Slug/name used in manifests | \`${markdownValue(name)}\` |
| Image | \`${markdownValue(image)}\` |
| Registry | \`${markdownValue(form.registry)}\` |
| Namespace | \`${markdownValue(form.namespace)}\` |
| Container port | \`${markdownValue(form.port)}\` |
| Replicas | \`${markdownValue(form.replicas)}\` |
| Ingress host | \`${markdownValue(form.ingressHost)}\` |
| Health path | \`${markdownValue(healthPath)}\` |
| CPU request/limit | \`${markdownValue(form.cpu)}\` |
| Memory request/limit | \`${markdownValue(form.memory)}\` |
| Config env keys | ${envNames.length ? envNames.map((key) => `\`${markdownValue(key)}\``).join(", ") : "\`APP_ENV\`"} |
| Secret placeholder keys | ${secretNames.length ? secretNames.map((key) => `\`${markdownValue(key)}\``).join(", ") : "\`EXAMPLE_SECRET\`"} |

## Generated Files

- \`Dockerfile\`: Container build template for the selected runtime preset.
- \`docker-compose.yml\`: Local Compose service with port mapping, environment entries, and health check.
- \`k8s.yaml\`: Namespace, ConfigMap, Secret placeholder, Deployment, Service, and Ingress.
- \`helm/Chart-and-values.yaml\`: Starter Helm chart content and values.
- \`.github/workflows/deploy.yml\`: GitHub Actions build/push/deploy workflow starter.
- \`test-deploy.sh\`: Validation helper with no-side-effect defaults and opt-in smoke-test commands.
- \`README.md\`: This generated guide.

## Quick Start

1. Put these generated files at the root of your application repository.
2. Review the image name, namespace, ingress host, resource values, and health path.
3. Replace secret placeholders through your secret-management workflow before any real deployment.
4. Build locally:

\`\`\`bash
docker build -t ${image} .
\`\`\`

5. Run the local Compose config if your app dependencies are available:

\`\`\`bash
docker compose up --build
\`\`\`

## Docker Compose Validation

Validate the Compose file without starting containers:

\`\`\`bash
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml config
\`\`\`

## Kubernetes Dry-Run Validation

Run client-side validation first:

\`\`\`bash
kubectl apply --dry-run=client -f k8s.yaml
\`\`\`

If you have access to a cluster API server, run server-side validation against a temporary smoke-test namespace:

\`\`\`bash
kubectl create namespace ${smokeNamespace} --dry-run=client -o yaml | kubectl apply --dry-run=server -f -
sed "s/namespace: ${form.namespace}/namespace: ${smokeNamespace}/g; s/name: ${form.namespace}/name: ${smokeNamespace}/g" k8s.yaml | kubectl apply --dry-run=server -f -
\`\`\`

You can also run:

\`\`\`bash
bash test-deploy.sh
\`\`\`

\`test-deploy.sh\` is safe/no-side-effect by default: it validates Docker Compose and performs Kubernetes dry-runs only. Its smoke-test commands are printed as opt-in steps and use the temporary namespace \`${smokeNamespace}\`.

## Optional kind/minikube Smoke Test

Use this only after reviewing the generated files and replacing placeholders as appropriate:

\`\`\`bash
kind create cluster --name shipconfig-smoke
# or:
# minikube start

kubectl create namespace ${smokeNamespace} --dry-run=client -o yaml | kubectl apply -f -
sed "s/namespace: ${form.namespace}/namespace: ${smokeNamespace}/g; s/name: ${form.namespace}/name: ${smokeNamespace}/g" k8s.yaml | kubectl apply -f -
kubectl -n ${smokeNamespace} rollout status deployment/${name} --timeout=120s
kubectl -n ${smokeNamespace} port-forward svc/${name} 8080:80
curl -fsS http://127.0.0.1:8080${healthPath}
\`\`\`

## Deployment Checklist

- Confirm \`${markdownValue(image)}\` exists in the registry and uses an immutable tag before production.
- Verify \`${markdownValue(form.ingressHost)}\` points at the intended ingress controller.
- Confirm the app listens on port \`${markdownValue(form.port)}\` inside the container.
- Confirm \`${markdownValue(healthPath)}\` returns success for readiness and liveness.
- Review replicas, CPU, and memory against expected traffic.
- Confirm RBAC, image pull secrets, ingress class, TLS, and network policies for the target cluster.
- Run both Compose validation and Kubernetes dry-run validation before applying.

## Secret Handling Warning

The generated Kubernetes Secret uses placeholder string data and this README intentionally lists only secret keys, not secret values. Do not commit real secrets in \`k8s.yaml\`, \`docker-compose.yml\`, shell history, CI logs, or this README. Use external secret managers, sealed secrets, encrypted CI variables, or cluster-native secret injection.

## Production Readiness Notes

- Replace \`:latest\` or floating image tags with immutable tags or digests.
- Add TLS configuration for Ingress before exposing public traffic.
- Add pod security settings, non-root runtime settings, and read-only filesystem options where your app supports them.
- Split ConfigMap, Secret, Deployment, Service, and Ingress into separate files or a full Helm chart as the project grows.
- Review HTTP probes for stateful or non-HTTP workloads; Redis/Postgres-style services usually need TCP or command probes.
- Tune resource requests/limits and autoscaling from real measurements.
- Add observability: structured logs, metrics, traces, alerts, and dashboard links.

## Cleanup Commands

\`\`\`bash
kubectl delete namespace ${smokeNamespace} --ignore-not-found
kind delete cluster --name shipconfig-smoke
# For minikube smoke tests:
# minikube delete
\`\`\`

## Troubleshooting Tips

- \`docker compose config\` fails: check indentation, env values containing special characters, and duplicate keys.
- Build fails: verify the Dockerfile matches your project layout and package manager.
- Image pull fails: verify registry login, repository name, tag, and image pull secret configuration.
- Pods stay pending: inspect resource requests, node capacity, taints, tolerations, and namespace quotas.
- Rollout fails: run \`kubectl -n ${form.namespace} describe deployment/${name}\` and inspect pod events.
- Health checks fail: verify the app serves \`${markdownValue(healthPath)}\` on container port \`${markdownValue(form.port)}\`.
- Ingress returns 404 or timeout: verify ingress class, DNS, service name, service port, and controller logs.
- Server dry-run fails: confirm your kubeconfig points at a reachable cluster and your user has validation permissions.
`;
}

function generateFiles(form: FormState) {
  const name = slug(form.appName);
  const image = `${form.registry.replace(/\/$/, "")}/${form.image}`;
  const env = parsePairs(form.envVars);
  const secrets = parsePairs(form.secrets);
  const envBlock = env.map((p) => `            - name: ${p.key}\n              valueFrom:\n                configMapKeyRef:\n                  name: ${name}-config\n                  key: ${p.key}`).join("\n");
  const secretBlock = secrets.map((p) => `            - name: ${p.key}\n              valueFrom:\n                secretKeyRef:\n                  name: ${name}-secret\n                  key: ${p.key}`).join("\n");
  const cmData = env.map((p) => `  ${p.key}: "${p.value.replaceAll('"', '\\"')}"`).join("\n") || "  APP_ENV: \"production\"";
  const secretData = secrets.map((p) => `  ${p.key}: "${p.value.replaceAll('"', '\\"')}"`).join("\n") || "  EXAMPLE_SECRET: \"change-me\"";

  const composeEnv = [...env, ...secrets].map((p) => `      ${p.key}: ${p.value}`).join("\n");
  const compose = `services:\n  ${name}:\n    build:\n      context: .\n      dockerfile: Dockerfile\n    image: ${image}\n    container_name: ${name}\n    restart: unless-stopped\n    ports:\n      - "${form.port}:${form.port}"\n    environment:\n${composeEnv || "      APP_ENV: production"}\n    healthcheck:\n      test: ["CMD-SHELL", "wget -qO- http://localhost:${form.port}${form.healthPath} || exit 1"]\n      interval: 30s\n      timeout: 5s\n      retries: 3\n`;

  const kubernetes = `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${form.namespace}\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}-config\n  namespace: ${form.namespace}\ndata:\n${cmData}\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: ${name}-secret\n  namespace: ${form.namespace}\ntype: Opaque\nstringData:\n${secretData}\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\n  namespace: ${form.namespace}\nspec:\n  replicas: ${form.replicas}\n  selector:\n    matchLabels:\n      app: ${name}\n  template:\n    metadata:\n      labels:\n        app: ${name}\n    spec:\n      containers:\n        - name: ${name}\n          image: ${image}\n          ports:\n            - containerPort: ${form.port}\n          env:\n${envBlock}${envBlock && secretBlock ? "\n" : ""}${secretBlock || "            - name: APP_ENV\n              value: production"}\n          resources:\n            requests:\n              cpu: ${form.cpu}\n              memory: ${form.memory}\n            limits:\n              cpu: ${form.cpu}\n              memory: ${form.memory}\n          readinessProbe:\n            httpGet:\n              path: ${form.healthPath}\n              port: ${form.port}\n            initialDelaySeconds: 10\n            periodSeconds: 10\n          livenessProbe:\n            httpGet:\n              path: ${form.healthPath}\n              port: ${form.port}\n            initialDelaySeconds: 30\n            periodSeconds: 20\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${name}\n  namespace: ${form.namespace}\nspec:\n  selector:\n    app: ${name}\n  ports:\n    - name: http\n      port: 80\n      targetPort: ${form.port}\n---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: ${name}\n  namespace: ${form.namespace}\n  annotations:\n    kubernetes.io/ingress.class: nginx\nspec:\n  rules:\n    - host: ${form.ingressHost}\n      http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend:\n              service:\n                name: ${name}\n                port:\n                  number: 80\n`;

  const values = `replicaCount: ${form.replicas}\n\nimage:\n  repository: ${image}\n  pullPolicy: IfNotPresent\n\nservice:\n  port: 80\n  targetPort: ${form.port}\n\ningress:\n  enabled: true\n  host: ${form.ingressHost}\n\nresources:\n  requests:\n    cpu: ${form.cpu}\n    memory: ${form.memory}\n  limits:\n    cpu: ${form.cpu}\n    memory: ${form.memory}\n\nenv:\n${env.map((p) => `  ${p.key}: "${p.value}"`).join("\n") || "  APP_ENV: production"}\n`;
  const helm = `# Chart.yaml\napiVersion: v2\nname: ${name}\ndescription: Generated Helm chart for ${name}\ntype: application\nversion: 0.1.0\nappVersion: "1.0.0"\n\n# values.yaml\n${values}\n# templates/deployment.yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Chart.Name }}\nspec:\n  replicas: {{ .Values.replicaCount }}\n  selector:\n    matchLabels:\n      app: {{ .Chart.Name }}\n  template:\n    metadata:\n      labels:\n        app: {{ .Chart.Name }}\n    spec:\n      containers:\n        - name: {{ .Chart.Name }}\n          image: {{ .Values.image.repository | quote }}\n          ports:\n            - containerPort: {{ .Values.service.targetPort }}\n`;

  const actions = `name: Build and Deploy Container\n\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\nenv:\n  IMAGE_NAME: ${image}\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n      packages: write\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker/setup-buildx-action@v3\n      - uses: docker/login-action@v3\n        with:\n          registry: ghcr.io\n          username: \${{ github.actor }}\n          password: \${{ secrets.GITHUB_TOKEN }}\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n          push: true\n          tags: \${{ env.IMAGE_NAME }}:latest\n      - name: Deploy to Kubernetes\n        run: |\n          kubectl apply -f k8s.yaml\n`;

  return {
    "Dockerfile": dockerfileFor(form.preset, form.port),
    "docker-compose.yml": compose,
    "k8s.yaml": kubernetes,
    "helm/Chart-and-values.yaml": helm,
    ".github/workflows/deploy.yml": actions,
    "test-deploy.sh": testDeployScriptFor(form),
    "README.md": readmeFor(form, image),
  };
}

export default function Home() {
  const [form, setForm] = useState<FormState>(initial);
  const [active, setActive] = useState<Tab>("kubernetes");
  const [copied, setCopied] = useState<string>("");
  const [savedLocally, setSavedLocally] = useState(false);
  const [hasLoadedClientState, setHasLoadedClientState] = useState(false);
  const [mode, setMode] = useState<Mode>("manual");
  const [resolveTarget, setResolveTarget] = useState<ResolveTarget>("docker");
  const [resolveQuery, setResolveQuery] = useState("");
  const [resolveStatus, setResolveStatus] = useState<ResolveStatus>("idle");
  const [resolveError, setResolveError] = useState("");
  const [suggestion, setSuggestion] = useState<ResolveSuggestion | null>(null);
  const files = useMemo(() => generateFiles(form), [form]);
  const preflightChecks = useMemo(() => buildPreflightChecks(form), [form]);
  const preflightSummary = useMemo(() => summarizeChecks(preflightChecks), [preflightChecks]);
  const persistedState = useMemo<PersistedState>(
    () => ({
      version: 1,
      form,
      mode,
      resolveTarget,
      resolveQuery,
    }),
    [form, mode, resolveQuery, resolveTarget],
  );
  const selected =
    active === "dockerfile"
      ? "Dockerfile"
      : active === "compose"
        ? "docker-compose.yml"
        : active === "kubernetes"
          ? "k8s.yaml"
          : active === "helm"
            ? "helm/Chart-and-values.yaml"
            : active === "actions"
              ? ".github/workflows/deploy.yml"
              : active === "testDeploy"
                ? "test-deploy.sh"
                : "README.md";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function currentPersistedState(): PersistedState {
    return persistedState;
  }

  useEffect(() => {
    const sharedState = parseSharedState();
    const storedState = parsePersistedState(window.localStorage.getItem(STORAGE_KEY));
    const nextState = sharedState ?? storedState;

    const loadTimer = window.setTimeout(() => {
      if (nextState) {
        setForm(nextState.form);
        setMode(nextState.mode);
        setResolveTarget(nextState.resolveTarget);
        setResolveQuery(nextState.resolveQuery);
      }

      setHasLoadedClientState(true);
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, []);

  useEffect(() => {
    if (!hasLoadedClientState) {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
      const saveTimer = window.setTimeout(() => setSavedLocally(true), 0);
      return () => window.clearTimeout(saveTimer);
    } catch {
      const saveTimer = window.setTimeout(() => setSavedLocally(false), 0);
      return () => window.clearTimeout(saveTimer);
    }
  }, [hasLoadedClientState, persistedState]);

  function applyPreset(preset: Preset) {
    setForm((prev) => ({ ...prev, ...presets[preset], preset }));
  }

  function selectResolveTarget(target: ResolveTarget) {
    setResolveTarget(target);
    setSuggestion(null);
    setResolveStatus("idle");
    setResolveError("");
  }

  async function resolveConfig() {
    const query = resolveQuery.trim();
    if (!query) {
      setResolveStatus("error");
      setResolveError("Enter an image or app query.");
      setSuggestion(null);
      return;
    }

    setResolveStatus("loading");
    setResolveError("");
    setSuggestion(null);

    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: resolveTarget, query }),
      });
      const data = (await response.json()) as ResolveResponse | { error?: string };

      if (!response.ok || !("suggestion" in data)) {
        const message = "error" in data ? data.error : "";
        throw new Error(message || "Unable to resolve image metadata.");
      }

      setSuggestion(data.suggestion);
      setResolveStatus("success");
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Unable to resolve image metadata.");
      setResolveStatus("error");
    }
  }

  function applySuggestion(next: ResolveSuggestion) {
    setForm((prev) => ({
      ...prev,
      preset: next.preset ?? prev.preset,
      appName: next.appName,
      image: next.image,
      registry: next.registry,
      port: next.port,
      healthPath: next.healthPath,
      envVars: next.envVars,
      secrets: next.secrets,
      namespace: next.namespace ?? prev.namespace,
      replicas: next.replicas ?? prev.replicas,
      cpu: next.cpu ?? prev.cpu,
      memory: next.memory ?? prev.memory,
      ingressHost: next.ingressHost ?? `${slug(next.appName)}.example.com`,
    }));
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  async function shareConfig() {
    const url = new URL(window.location.href);
    url.hash = `${SHARE_PARAM}=${encodeURIComponent(JSON.stringify(currentPersistedState()))}`;
    await copy(url.toString(), "share");
  }

  function fixPreflight(label: string) {
    if (label === "Image tag") {
      update("image", imageWithPinnedPlaceholder(form.image));
      return;
    }

    if (label === "Secret placeholders") {
      update("secrets", replacePlaceholderSecrets(form.secrets));
      return;
    }

    if (label === "Ingress domain") {
      update("ingressHost", "api.example.com");
      return;
    }

    if (label === "Resources") {
      setForm((prev) => ({ ...prev, cpu: initial.cpu, memory: initial.memory }));
      return;
    }

    if (label === "Replicas") {
      const replicas = Number.isFinite(form.replicas) ? form.replicas : initial.replicas;
      update("replicas", Math.min(10, Math.max(1, Math.round(replicas))));
    }
  }

  function canFixPreflight(label: string) {
    return ["Image tag", "Secret placeholders", "Ingress domain", "Resources", "Replicas"].includes(label);
  }

  async function downloadZip() {
    const zip = new JSZip();
    Object.entries(files).forEach(([path, content]) => zip.file(path, content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(form.appName)}-configs.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#080b10] text-slate-100">
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-800/90 bg-[#090d13]/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900 text-sky-300">
                <Layers3 className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-semibold tracking-wide text-slate-100">ShipConfig</h1>
                  <span className="hidden rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:inline">
                    Infra Workbench
                  </span>
                </div>
                <p className="hidden text-xs text-slate-500 sm:block">Docker, Compose, Kubernetes, Helm and CI config generator</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-400">
                <CheckCircle2 className={`size-3.5 ${savedLocally ? "text-emerald-300" : "text-slate-600"}`} />
                <span className="hidden min-[460px]:inline">Saved locally</span>
              </div>
              <div className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs md:flex ${preflightSummary.fail ? "border-rose-500/30 bg-rose-500/10 text-rose-100" : preflightSummary.warn ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"}`}>
                {preflightSummary.fail || preflightSummary.warn ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                {preflightSummary.pass} pass / {preflightSummary.warn} warn / {preflightSummary.fail} fail
              </div>
              <button
                onClick={shareConfig}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
              >
                <Share2 className="size-4" />
                <span className="hidden sm:inline">{copied === "share" ? "Copied" : "Share"}</span>
              </button>
              <button
                onClick={downloadZip}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/15 px-3 text-sm font-medium text-sky-100 transition hover:border-sky-300/50 hover:bg-sky-400/20"
              >
                <Download className="size-4" />
                <span className="hidden sm:inline">Download ZIP</span>
                <span className="sm:hidden">ZIP</span>
              </button>
            </div>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-[1540px] flex-1 gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:px-6">
          <aside className="rounded-xl border border-slate-800 bg-[#0c1118] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] lg:max-h-[calc(100vh-96px)] lg:overflow-auto">
            <div className="border-b border-slate-800 px-4 py-3">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Settings2 className="size-4 text-sky-300" />
                  Settings
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-[#070a0f] p-1">
                  {[
                    ["manual", "Manual Config"],
                    ["auto", "Auto Resolve"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setMode(id as Mode)}
                      className={`h-8 rounded-md px-2 text-xs font-medium transition ${
                        mode === id
                          ? "bg-slate-800 text-sky-100"
                          : "text-slate-500 hover:bg-slate-900 hover:text-slate-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-5 p-4">
              {mode === "auto" ? (
                <section className="grid gap-2.5 rounded-lg border border-slate-800 bg-[#090d13]/55 p-3">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    <Wand2 className="size-3" />
                    Auto Resolve
                  </div>
                  <div className="grid gap-1 text-[11px] font-medium text-slate-500">
                    <div id="resolve-target-label">Target/source type</div>
                    <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-labelledby="resolve-target-label">
                      {(Object.entries(resolveTargets) as [ResolveTarget, (typeof resolveTargets)[ResolveTarget]][]).map(([target, meta]) => {
                        const isSelected = resolveTarget === target;

                        return (
                          <button
                            key={target}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => selectResolveTarget(target)}
                            className={`min-h-8 rounded-md border px-2 py-1.5 text-left text-[11px] font-medium leading-4 transition ${
                              isSelected
                                ? "border-sky-400/50 bg-sky-400/15 text-sky-100 shadow-[0_0_0_1px_rgba(56,189,248,0.08)_inset]"
                                : "border-slate-800 bg-[#070a0f] text-slate-400 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-200"
                            }`}
                          >
                            {meta.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className="grid gap-1 text-[11px] font-medium text-slate-500">
                    App or image query
                    <div className="grid gap-2 min-[390px]:grid-cols-[minmax(0,1fr)_auto]">
                      <input
                        value={resolveQuery}
                        onChange={(e) => setResolveQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            void resolveConfig();
                          }
                        }}
                        className="h-8 min-w-0 rounded-md border border-slate-800 bg-[#070a0f] px-2.5 text-xs font-normal text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                      />
                      <button
                        onClick={resolveConfig}
                        disabled={resolveStatus === "loading"}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-400/15 px-2.5 text-xs font-medium text-sky-100 transition hover:border-sky-300/50 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resolveStatus === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                        Resolve
                      </button>
                    </div>
                  </label>
                  <p className="text-[11px] leading-4 text-slate-500">
                    {resolveTargets[resolveTarget].helper}
                  </p>

                  {resolveStatus === "loading" ? (
                    <div className="rounded-md border border-slate-800 bg-[#070a0f] px-2.5 py-2 text-[11px] text-slate-400">
                      Resolving metadata and template hints...
                    </div>
                  ) : null}

                  {resolveStatus === "error" ? (
                    <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-4 text-rose-100">
                      {resolveError}
                    </div>
                  ) : null}

                  {suggestion ? (
                    <div className="rounded-md border border-slate-800 bg-[#070a0f] p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-slate-100">{suggestion.appName}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                            {suggestion.registry}/{suggestion.image}
                          </div>
                        </div>
                        <div className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200">
                          {Math.round(suggestion.confidence * 100)}%
                        </div>
                      </div>
                      <div className="mt-2 grid gap-1.5 text-[11px] leading-4 text-slate-400">
                        <div>
                          <span className="text-slate-500">{resolveTargets[resolveTarget].sourceLabel}:</span>{" "}
                          {suggestion.source}
                        </div>
                        <div>
                          <span className="text-slate-500">Confidence:</span> {Math.round(suggestion.confidence * 100)}%
                        </div>
                        <div>
                          <span className="text-slate-500">Description:</span> {suggestion.description}
                        </div>
                        <div>
                          <span className="text-slate-500">Port:</span> {suggestion.port}{" "}
                          <span className="text-slate-600">Health:</span> {suggestion.healthPath}
                        </div>
                        {suggestion.replicas || suggestion.cpu || suggestion.memory ? (
                          <div>
                            {suggestion.replicas ? (
                              <>
                                <span className="text-slate-500">Replicas:</span> {suggestion.replicas}{" "}
                              </>
                            ) : null}
                            {suggestion.cpu || suggestion.memory ? (
                              <>
                                <span className="text-slate-600">Resources:</span> {[suggestion.cpu, suggestion.memory].filter(Boolean).join(" / ")}
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <button
                        onClick={() => applySuggestion(suggestion)}
                        className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                      >
                        <CheckCircle2 className="size-3.5" />
                        Apply to config
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <Server className="size-3.5" />
                  Presets
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {(Object.keys(presets) as Preset[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => applyPreset(p)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition ${
                        form.preset === p
                          ? "border-sky-400/45 bg-sky-400/10 text-sky-100"
                          : "border-slate-800 bg-[#090d13] text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                      }`}
                    >
                      <div className="text-sm font-medium">{presets[p].label}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{presets[p].description}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="grid gap-3 rounded-lg border border-slate-800/80 bg-[#090d13]/45 p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <TerminalSquare className="size-3.5" />
                  Runtime
                </div>
                {[
                  ["App name", "appName"],
                  ["Image", "image"],
                  ["Registry", "registry"],
                  ["Namespace", "namespace"],
                ].map(([label, key]) => (
                  <label key={key} className="grid gap-1.5 text-xs font-medium text-slate-400">
                    {label}
                    <input
                      value={String(form[key as keyof FormState])}
                      onChange={(e) => update(key as keyof FormState, e.target.value as never)}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                    />
                  </label>
                ))}
              </section>

              <section className="grid gap-3 rounded-lg border border-slate-800/80 bg-[#090d13]/45 p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <GitBranch className="size-3.5" />
                  Networking
                </div>
                <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                  Ingress host
                  <input
                    value={form.ingressHost}
                    onChange={(e) => update("ingressHost", e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                    Port
                    <input
                      type="number"
                      value={form.port}
                      onChange={(e) => update("port", Number(e.target.value))}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                    Health path
                    <input
                      value={form.healthPath}
                      onChange={(e) => update("healthPath", e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                    />
                  </label>
                </div>
              </section>

              <section className="grid gap-3 rounded-lg border border-slate-800/80 bg-[#090d13]/45 p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <Server className="size-3.5" />
                  Resources
                </div>
                <div className="grid gap-3 min-[390px]:grid-cols-3">
                  <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                    Replicas
                    <input
                      type="number"
                      value={form.replicas}
                      onChange={(e) => update("replicas", Number(e.target.value))}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                    CPU
                    <input
                      value={form.cpu}
                      onChange={(e) => update("cpu", e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                    Memory
                    <input
                      value={form.memory}
                      onChange={(e) => update("memory", e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                    />
                  </label>
                </div>
              </section>

              <section className="grid gap-3 rounded-lg border border-slate-800/80 bg-[#090d13]/45 p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <FileCode2 className="size-3.5" />
                  Environment
                </div>
                <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                  Config env vars
                  <textarea
                    value={form.envVars}
                    onChange={(e) => update("envVars", e.target.value)}
                    rows={5}
                    className="w-full resize-y rounded-lg border border-slate-800 bg-[#070a0f] px-3 py-2 font-mono text-xs font-normal leading-5 text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-slate-400">
                  Secret placeholders
                  <textarea
                    value={form.secrets}
                    onChange={(e) => update("secrets", e.target.value)}
                    rows={5}
                    className="w-full resize-y rounded-lg border border-slate-800 bg-[#070a0f] px-3 py-2 font-mono text-xs font-normal leading-5 text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                  />
                </label>
              </section>

              <section className="rounded-lg border border-slate-800 bg-[#090d13] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {preflightSummary.fail || preflightSummary.warn ? <AlertTriangle className="size-3.5 text-amber-300" /> : <CheckCircle2 className="size-3.5 text-emerald-300" />}
                    Preflight checks
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
                    <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">{preflightSummary.pass} pass</span>
                    <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">{preflightSummary.warn} warn</span>
                    <span className="rounded-md border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-rose-200">{preflightSummary.fail} fail</span>
                  </div>
                </div>
                <div className="grid gap-2">
                  {preflightChecks.map((check) => (
                    <div key={check.label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 text-xs leading-5">
                      <span
                        className={`mt-1 size-2 rounded-full ${
                          check.severity === "pass" ? "bg-emerald-400" : check.severity === "warn" ? "bg-amber-300" : "bg-rose-400"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-300">{check.label}</div>
                        <div className="text-slate-500">{check.message}</div>
                      </div>
                      {check.severity !== "pass" && canFixPreflight(check.label) ? (
                        <button
                          type="button"
                          onClick={() => fixPreflight(check.label)}
                          className="self-start rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-300 transition hover:border-sky-400/40 hover:bg-slate-800 hover:text-sky-100"
                        >
                          Fix
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-[#0c1118] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
            <div className="flex min-h-12 flex-col gap-2 border-b border-slate-800 bg-[#0a0f15] px-3 py-2 xl:flex-row xl:items-center">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActive(tab.id)}
                    className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border px-3 font-mono text-xs transition ${
                      active === tab.id
                        ? "border-sky-400/40 bg-sky-400/12 text-sky-100"
                        : "border-transparent text-slate-400 hover:border-slate-800 hover:bg-slate-900 hover:text-slate-200"
                    }`}
                  >
                    <FileCode2 className="size-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => copy(files[selected], selected)}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 xl:ml-3"
              >
                <Copy className="size-4" />
                {copied === selected ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2 text-sm text-slate-400">
                <GitBranch className="size-4 shrink-0 text-sky-300" />
                <span className="truncate font-mono">{selected}</span>
              </div>
              <div className="font-mono text-xs text-slate-600">{files[selected].split("\n").length} lines</div>
            </div>
            <pre className="max-h-[calc(100vh-169px)] min-h-[520px] overflow-auto bg-[#070a0f] p-4 font-mono text-sm leading-6 text-slate-200 sm:p-5"><code>{files[selected]}</code></pre>
          </section>
        </section>
      </div>
    </main>
  );
}
