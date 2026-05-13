"use client";

import JSZip from "jszip";
import { Copy, Download, FileCode2, Layers3, Rocket, ShieldCheck, Sparkles } from "lucide-react";
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
  { id: "compose", label: "Compose" },
  { id: "kubernetes", label: "Kubernetes" },
  { id: "helm", label: "Helm" },
  { id: "actions", label: "GitHub Actions" },
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
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <nav className="flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-300"><Layers3 /></div><span className="text-xl font-bold">ShipConfig</span></div>
          <button onClick={downloadZip} className="rounded-full bg-cyan-300 px-5 py-2.5 font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 hover:bg-cyan-200"><Download className="mr-2 inline size-4"/>Download ZIP</button>
        </nav>

        <div className="grid gap-8 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-200"><Sparkles className="size-4"/> Docker, Compose, Kubernetes, Helm and CI in one pass</div>
            <h1 className="text-5xl font-black tracking-tight md:text-7xl">Generate deploy-ready container configs.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">ShipConfig turns a few app details into production-friendly Dockerfiles, compose stacks, Kubernetes manifests, Helm starter charts and GitHub Actions workflows. Everything runs in your browser — no secrets leave the page.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["Copy-ready YAML", "Health probes", "Resource limits"].map((item) => <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-200"><ShieldCheck className="mb-2 size-5 text-emerald-300"/>{item}</div>)}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-cyan-950/40 backdrop-blur">
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(presets) as Preset[]).map((p) => <button key={p} onClick={() => applyPreset(p)} className={`rounded-2xl border p-4 text-left transition ${form.preset === p ? "border-cyan-300 bg-cyan-300/10" : "border-white/10 bg-slate-900/70 hover:border-white/30"}`}><div className="font-semibold">{presets[p].label}</div><div className="mt-1 text-xs text-slate-400">{presets[p].description}</div></button>)}
            </div>
          </div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><Rocket className="text-cyan-300"/> Configure</h2>
            <div className="grid gap-4">
              {[
                ["App name", "appName"], ["Image", "image"], ["Registry", "registry"], ["Namespace", "namespace"], ["Ingress host", "ingressHost"], ["Health path", "healthPath"], ["CPU", "cpu"], ["Memory", "memory"],
              ].map(([label, key]) => <label key={key} className="text-sm text-slate-300">{label}<input value={String(form[key as keyof FormState])} onChange={(e) => update(key as keyof FormState, e.target.value as never)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-300"/></label>)}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-slate-300">Port<input type="number" value={form.port} onChange={(e) => update("port", Number(e.target.value))} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2"/></label>
                <label className="text-sm text-slate-300">Replicas<input type="number" value={form.replicas} onChange={(e) => update("replicas", Number(e.target.value))} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2"/></label>
              </div>
              <label className="text-sm text-slate-300">Config env vars<textarea value={form.envVars} onChange={(e) => update("envVars", e.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs"/></label>
              <label className="text-sm text-slate-300">Secret placeholders<textarea value={form.secrets} onChange={(e) => update("secrets", e.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs"/></label>
              {validation.length > 0 && <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">{validation.join(" · ")}</div>}
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80">
            <div className="flex flex-wrap gap-2 border-b border-white/10 p-3">
              {tabs.map((tab) => <button key={tab.id} onClick={() => setActive(tab.id)} className={`rounded-full px-4 py-2 text-sm font-medium ${active === tab.id ? "bg-cyan-300 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>{tab.label}</button>)}
              <button onClick={() => copy(files[selected], selected)} className="ml-auto rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/15"><Copy className="mr-2 inline size-4"/>{copied === selected ? "Copied" : "Copy"}</button>
            </div>
            <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3 text-sm text-slate-400"><FileCode2 className="size-4"/>{selected}</div>
            <pre className="max-h-[720px] overflow-auto p-5 text-sm leading-6 text-slate-200"><code>{files[selected]}</code></pre>
          </div>
        </section>
      </section>
    </main>
  );
}
