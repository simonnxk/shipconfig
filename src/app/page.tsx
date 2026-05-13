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
  Server,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import { useMemo, useState } from "react";

type Preset = "node" | "python" | "go" | "static";
type Tab = "dockerfile" | "compose" | "kubernetes" | "helm" | "actions";

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
  secrets: "DATABASE_URL=postgres://user:pass@host:5432/app\nJWT_SECRET=change-me",
  cpu: "500m",
  memory: "512Mi",
};

const tabs: { id: Tab; label: string }[] = [
  { id: "dockerfile", label: "Dockerfile" },
  { id: "compose", label: "docker-compose.yml" },
  { id: "kubernetes", label: "k8s.yaml" },
  { id: "helm", label: "helm/" },
  { id: "actions", label: ".github/workflows/deploy.yml" },
];

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
  };
}

export default function Home() {
  const [form, setForm] = useState<FormState>(initial);
  const [active, setActive] = useState<Tab>("kubernetes");
  const [copied, setCopied] = useState<string>("");
  const files = useMemo(() => generateFiles(form), [form]);
  const selected = active === "dockerfile" ? "Dockerfile" : active === "compose" ? "docker-compose.yml" : active === "kubernetes" ? "k8s.yaml" : active === "helm" ? "helm/Chart-and-values.yaml" : ".github/workflows/deploy.yml";
  const validation = [!form.appName && "App name is required", !form.image && "Image is required", form.port <= 0 && "Port must be positive", !form.ingressHost.includes(".") && "Ingress host should be a domain"].filter(Boolean);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyPreset(preset: Preset) {
    setForm((prev) => ({ ...prev, ...presets[preset], preset }));
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
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
              <div className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs md:flex ${validation.length ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"}`}>
                {validation.length ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                {validation.length ? `${validation.length} issue${validation.length > 1 ? "s" : ""}` : "Valid"}
              </div>
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
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Settings2 className="size-4 text-sky-300" />
                Settings
              </div>
            </div>

            <div className="space-y-5 p-4">
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

              <section className="grid gap-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <TerminalSquare className="size-3.5" />
                  Runtime
                </div>
                {[
                  ["App name", "appName"],
                  ["Image", "image"],
                  ["Registry", "registry"],
                  ["Namespace", "namespace"],
                  ["Ingress host", "ingressHost"],
                  ["Health path", "healthPath"],
                  ["CPU", "cpu"],
                  ["Memory", "memory"],
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
                    Replicas
                    <input
                      type="number"
                      value={form.replicas}
                      onChange={(e) => update("replicas", Number(e.target.value))}
                      className="h-9 w-full rounded-lg border border-slate-800 bg-[#070a0f] px-3 text-sm font-normal text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10"
                    />
                  </label>
                </div>
              </section>

              <section className="grid gap-3">
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

              <div className={`rounded-lg border px-3 py-2.5 text-xs leading-5 ${validation.length ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"}`}>
                <div className="mb-1 flex items-center gap-2 font-medium">
                  {validation.length ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                  Validation
                </div>
                {validation.length ? validation.join(" | ") : "Configuration is ready to export."}
              </div>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-[#0c1118] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
            <div className="flex min-h-12 flex-col gap-2 border-b border-slate-800 bg-[#0a0f15] px-3 py-2 xl:flex-row xl:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
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
