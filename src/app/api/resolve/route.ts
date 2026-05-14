import { NextResponse } from "next/server";

type Preset = "node" | "python" | "go" | "static";
type ResolveTarget = "docker" | "kubernetes" | "compose" | "helm" | "github-actions" | "runtime";
type ResolveHint = "auto" | ResolveTarget | "app-description";

type ResolveRequest = {
  query?: unknown;
  target?: unknown;
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

type DockerHubRepository = {
  name?: string;
  namespace?: string;
  repo_name?: string;
  description?: string;
  short_description?: string;
  is_official?: boolean;
  star_count?: number;
  pull_count?: number;
};

const curated: Record<string, ResolveSuggestion> = {
  litellm: {
    appName: "litellm",
    image: "berriai/litellm:main-latest",
    registry: "ghcr.io",
    port: 4000,
    healthPath: "/health/readiness",
    envVars: "LITELLM_MODE=PRODUCTION\nSTORE_MODEL_IN_DB=True",
    secrets: "LITELLM_MASTER_KEY=change-me\nOPENAI_API_KEY=change-me\nDATABASE_URL=postgresql://litellm:change-me@postgres:5432/litellm",
    source: "curated template",
    confidence: 0.98,
    description: "LiteLLM proxy server using the upstream GHCR image and readiness endpoint.",
    preset: "python",
  },
  "berriai/litellm": {
    appName: "litellm",
    image: "berriai/litellm:main-latest",
    registry: "ghcr.io",
    port: 4000,
    healthPath: "/health/readiness",
    envVars: "LITELLM_MODE=PRODUCTION\nSTORE_MODEL_IN_DB=True",
    secrets: "LITELLM_MASTER_KEY=change-me\nOPENAI_API_KEY=change-me\nDATABASE_URL=postgresql://litellm:change-me@postgres:5432/litellm",
    source: "curated template",
    confidence: 0.98,
    description: "LiteLLM proxy server using the upstream GHCR image and readiness endpoint.",
    preset: "python",
  },
  nginx: {
    appName: "nginx",
    image: "library/nginx:latest",
    registry: "docker.io",
    port: 80,
    healthPath: "/",
    envVars: "NGINX_ENTRYPOINT_QUIET_LOGS=1",
    secrets: "TLS_CERT=change-me\nTLS_KEY=change-me",
    source: "curated template",
    confidence: 0.94,
    description: "nginx web server or static file gateway.",
    preset: "static",
  },
  redis: {
    appName: "redis",
    image: "library/redis:latest",
    registry: "docker.io",
    port: 6379,
    healthPath: "/",
    envVars: "REDIS_APPENDONLY=yes",
    secrets: "REDIS_PASSWORD=change-me",
    source: "curated template",
    confidence: 0.91,
    description: "Redis in-memory data store. Configure probes carefully because Redis is not HTTP-native.",
  },
  postgres: {
    appName: "postgres",
    image: "library/postgres:latest",
    registry: "docker.io",
    port: 5432,
    healthPath: "/",
    envVars: "POSTGRES_DB=app\nPOSTGRES_USER=app",
    secrets: "POSTGRES_PASSWORD=change-me",
    source: "curated template",
    confidence: 0.92,
    description: "PostgreSQL database container. Replace HTTP probes with database-native checks before production.",
  },
  ollama: {
    appName: "ollama",
    image: "ollama/ollama:latest",
    registry: "docker.io",
    port: 11434,
    healthPath: "/api/tags",
    envVars: "OLLAMA_HOST=0.0.0.0:11434\nOLLAMA_KEEP_ALIVE=5m",
    secrets: "OLLAMA_AUTH_TOKEN=change-me",
    source: "curated template",
    confidence: 0.93,
    description: "Ollama model server with the default HTTP API port.",
  },
  node: {
    appName: "node-app",
    image: "library/node:22-alpine",
    registry: "docker.io",
    port: 3000,
    healthPath: "/health",
    envVars: "NODE_ENV=production\nLOG_LEVEL=info",
    secrets: "SESSION_SECRET=change-me",
    source: "curated template",
    confidence: 0.82,
    description: "Generic Node.js application container template.",
    preset: "node",
  },
  python: {
    appName: "python-app",
    image: "library/python:3.12-slim",
    registry: "docker.io",
    port: 8000,
    healthPath: "/healthz",
    envVars: "PYTHONUNBUFFERED=1\nAPP_ENV=production",
    secrets: "APP_SECRET_KEY=change-me",
    source: "curated template",
    confidence: 0.82,
    description: "Generic Python service container template.",
    preset: "python",
  },
};

const knownPorts: Record<string, number> = {
  caddy: 80,
  grafana: 3000,
  httpd: 80,
  mariadb: 3306,
  mongo: 27017,
  mysql: 3306,
  nextcloud: 80,
  nginx: 80,
  node: 3000,
  ollama: 11434,
  postgres: 5432,
  postgresql: 5432,
  python: 8000,
  rabbitmq: 5672,
  redis: 6379,
  traefik: 80,
};

const knownHealthPaths: Record<string, string> = {
  grafana: "/api/health",
  litellm: "/health/readiness",
  nextcloud: "/status.php",
  ollama: "/api/tags",
};

const statefulWorkloads = new Set(["postgres", "postgresql", "redis", "ollama"]);
const resolveHints = new Set<ResolveHint>(["auto", "docker", "kubernetes", "compose", "helm", "github-actions", "runtime", "app-description"]);
const knownDockerImageNames = new Set([
  "caddy",
  "httpd",
  "litellm",
  "mariadb",
  "mongo",
  "mysql",
  "nextcloud",
  "nginx",
  "node",
  "ollama",
  "postgres",
  "postgresql",
  "python",
  "rabbitmq",
  "redis",
  "traefik",
]);

const kubernetesProfiles: Record<string, Partial<ResolveSuggestion>> = {
  litellm: {
    namespace: "production",
    replicas: 3,
    cpu: "500m",
    memory: "1Gi",
    source: "curated Kubernetes workload profile",
    description: "LiteLLM proxy workload with production namespace, three replicas, HTTP readiness, and placeholder secrets.",
  },
  "berriai/litellm": {
    namespace: "production",
    replicas: 3,
    cpu: "500m",
    memory: "1Gi",
    source: "curated Kubernetes workload profile",
    description: "LiteLLM proxy workload with production namespace, three replicas, HTTP readiness, and placeholder secrets.",
  },
  nginx: {
    namespace: "production",
    replicas: 3,
    cpu: "100m",
    memory: "128Mi",
    source: "curated Kubernetes workload profile",
    description: "nginx stateless web workload with production namespace, three replicas, ingress, and conservative resources.",
  },
  redis: {
    namespace: "production",
    replicas: 1,
    cpu: "250m",
    memory: "512Mi",
    source: "curated Kubernetes workload profile",
    description: "Redis cache workload defaults to one replica and placeholder authentication. Add persistent storage before production.",
  },
  postgres: {
    namespace: "production",
    replicas: 1,
    cpu: "500m",
    memory: "1Gi",
    source: "curated Kubernetes workload profile",
    description: "PostgreSQL database workload defaults to one replica and placeholder credentials. Add persistent storage before production.",
  },
  ollama: {
    namespace: "production",
    replicas: 1,
    cpu: "1000m",
    memory: "4Gi",
    source: "curated Kubernetes workload profile",
    description: "Ollama model server workload defaults to one replica, larger memory, HTTP API health checks, and placeholder auth.",
  },
  node: {
    namespace: "production",
    replicas: 3,
    cpu: "300m",
    memory: "512Mi",
    source: "curated Kubernetes workload profile",
    description: "Generic Node.js stateless workload with three replicas, HTTP health checks, and production env defaults.",
  },
  python: {
    namespace: "production",
    replicas: 3,
    cpu: "300m",
    memory: "512Mi",
    source: "curated Kubernetes workload profile",
    description: "Generic Python stateless workload with three replicas, HTTP health checks, and production env defaults.",
  },
};

function normalizeKey(value: string) {
  return value.toLowerCase().trim().replace(/^docker\.io\//, "").replace(/^ghcr\.io\//, "").replace(/^library\//, "");
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "app";
}

function splitImage(input: string) {
  const clean = input.trim().replace(/^https?:\/\//, "");
  const withoutTag = clean.includes(":") ? clean.slice(0, clean.lastIndexOf(":")) : clean;
  const withoutRegistry = withoutTag
    .replace(/^docker\.io\//, "")
    .replace(/^registry-1\.docker\.io\//, "")
    .replace(/^index\.docker\.io\//, "");
  const parts = withoutRegistry.split("/").filter(Boolean);

  if (parts.length >= 2 && (parts[0].includes(".") || parts[0].includes(":"))) {
    return { namespace: parts[1] ?? "library", name: parts[2] ?? parts[1] ?? "app" };
  }

  if (parts.length >= 2) {
    return { namespace: parts[0], name: parts[1] };
  }

  return { namespace: "library", name: parts[0] || clean };
}

function hasDockerLookupHint(query: string) {
  const normalized = query.toLowerCase().trim();
  return /\b(docker hub|docker image|container image|image name|image identifier|registry)\b/.test(normalized) || normalized.startsWith("docker ");
}

function isExplicitDockerImageIdentifier(query: string) {
  const clean = query.trim().toLowerCase().replace(/^https?:\/\//, "");
  if (!clean || /\s/.test(clean)) {
    return false;
  }

  if (clean.includes("@sha256:")) {
    return true;
  }

  const lastSlash = clean.lastIndexOf("/");
  const lastColon = clean.lastIndexOf(":");
  const hasTag = lastColon > lastSlash;
  const withoutTag = hasTag ? clean.slice(0, lastColon) : clean;
  const parts = withoutTag.split("/").filter(Boolean);

  if (parts.length >= 2) {
    return true;
  }

  return hasTag || knownDockerImageNames.has(normalizeKey(withoutTag));
}

function withLatestTag(image: string) {
  const lastSlash = image.lastIndexOf("/");
  const lastColon = image.lastIndexOf(":");
  return lastColon > lastSlash ? image : `${image}:latest`;
}

function inferPreset(name: string): Preset | undefined {
  if (["node", "next", "express", "nestjs", "fastify"].some((part) => name.includes(part))) {
    return "node";
  }
  if (["python", "django", "fastapi", "flask", "uvicorn"].some((part) => name.includes(part))) {
    return "python";
  }
  if (["go", "golang", "gin", "fiber"].some((part) => name.includes(part))) {
    return "go";
  }
  if (["nginx", "httpd", "caddy", "static", "spa", "vite", "react"].some((part) => name.includes(part))) {
    return "static";
  }
  return undefined;
}

function inferPort(name: string) {
  const key = Object.keys(knownPorts).find((candidate) => name.includes(candidate));
  return key ? knownPorts[key] : 8080;
}

function inferHealthPath(name: string) {
  const key = Object.keys(knownHealthPaths).find((candidate) => name.includes(candidate));
  return key ? knownHealthPaths[key] : "/health";
}

function inferResolveTarget(query: string): ResolveTarget {
  const normalized = normalizeKey(query);
  const words = normalized.split(/[^a-z0-9./:_-]+/).filter(Boolean);
  const hasPhrase = (phrases: string[]) => phrases.some((phrase) => normalized.includes(phrase));

  if (hasPhrase(["github actions", "workflow", "ci/cd", "ci pipeline", "deploy pipeline"])) {
    return "github-actions";
  }
  if (hasPhrase(["helm", "chart", "values.yaml"])) {
    return "helm";
  }
  if (hasPhrase(["kubernetes", "k8s", "deployment", "ingress", "kubectl", "namespace"])) {
    return "kubernetes";
  }
  if (hasPhrase(["docker compose", "docker-compose", "compose.yaml", "compose.yml"])) {
    return "compose";
  }
  if (hasDockerLookupHint(query) || isExplicitDockerImageIdentifier(query)) {
    return "docker";
  }
  if (hasPhrase(["node", "next", "express", "nestjs", "fastify", "python", "django", "fastapi", "flask", "go api", "golang", "react app", "static site"])) {
    return "runtime";
  }
  if (words.length > 1) {
    return "runtime";
  }

  return "runtime";
}

function inferReplicas(name: string) {
  return [...statefulWorkloads].some((candidate) => name.includes(candidate)) ? 1 : 3;
}

function inferResources(name: string) {
  if (name.includes("ollama")) {
    return { cpu: "1000m", memory: "4Gi" };
  }
  if (["postgres", "postgresql"].some((candidate) => name.includes(candidate))) {
    return { cpu: "500m", memory: "1Gi" };
  }
  if (name.includes("redis")) {
    return { cpu: "250m", memory: "512Mi" };
  }
  if (["nginx", "httpd", "caddy"].some((candidate) => name.includes(candidate))) {
    return { cpu: "100m", memory: "128Mi" };
  }
  return { cpu: "300m", memory: "512Mi" };
}

function fromDockerHub(repo: DockerHubRepository, query: string): ResolveSuggestion {
  const namespace = repo.namespace || repo.repo_name?.split("/")[0] || splitImage(query).namespace;
  const name = repo.name || repo.repo_name?.split("/").pop() || splitImage(query).name;
  const normalizedName = slug(name);
  const repoPath = namespace === "library" ? `library/${name}` : `${namespace}/${name}`;
  const knownName = normalizeKey(`${namespace}/${name}`);
  const description = repo.description || repo.short_description || `Docker Hub metadata for ${repoPath}.`;
  const popularity = Math.min(((repo.star_count ?? 0) / 10000) + ((repo.pull_count ?? 0) / 1000000000), 0.2);

  return {
    appName: normalizedName,
    image: withLatestTag(repoPath),
    registry: "docker.io",
    port: inferPort(knownName),
    healthPath: inferHealthPath(knownName),
    envVars: "APP_ENV=production\nLOG_LEVEL=info",
    secrets: "APP_SECRET=change-me",
    source: repo.is_official ? "Docker Hub official image metadata" : "Docker Hub public image metadata",
    confidence: Math.min(repo.is_official ? 0.76 + popularity : 0.64 + popularity, 0.88),
    description,
    preset: inferPreset(knownName),
  };
}

async function fetchJson<T>(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveFromDockerHub(query: string) {
  const exact = splitImage(query);
  const exactUrl = `https://hub.docker.com/v2/repositories/${encodeURIComponent(exact.namespace)}/${encodeURIComponent(exact.name)}/`;
  const exactRepo = await fetchJson<DockerHubRepository>(exactUrl);

  if (exactRepo) {
    return fromDockerHub(exactRepo, query);
  }

  const searchUrl = `https://hub.docker.com/v2/search/repositories/?page_size=1&query=${encodeURIComponent(query)}`;
  const search = await fetchJson<{ results?: DockerHubRepository[] }>(searchUrl);
  const first = search?.results?.[0];

  if (first) {
    return fromDockerHub(first, query);
  }

  const fallbackName = slug(exact.name || query);
  const lookupName = normalizeKey(query);

  return {
    appName: fallbackName,
    image: withLatestTag(exact.namespace === "library" ? `library/${fallbackName}` : `${exact.namespace}/${fallbackName}`),
    registry: "docker.io",
    port: inferPort(lookupName),
    healthPath: inferHealthPath(lookupName),
    envVars: "APP_ENV=production\nLOG_LEVEL=info",
    secrets: "APP_SECRET=change-me",
    source: "inferred from query",
    confidence: 0.38,
    description: "No Docker Hub metadata was found. Values are inferred defaults and need verification.",
    preset: inferPreset(lookupName),
  } satisfies ResolveSuggestion;
}

function withKubernetesDefaults(suggestion: ResolveSuggestion, query: string): ResolveSuggestion {
  const normalizedQuery = normalizeKey(query);
  const normalizedName = normalizeKey(suggestion.appName);
  const profile = kubernetesProfiles[normalizedQuery] ?? kubernetesProfiles[slug(normalizedQuery)] ?? kubernetesProfiles[normalizedName];
  const resources = inferResources(`${normalizedQuery} ${normalizedName}`);

  return {
    ...suggestion,
    namespace: profile?.namespace ?? "production",
    replicas: profile?.replicas ?? inferReplicas(`${normalizedQuery} ${normalizedName}`),
    cpu: profile?.cpu ?? resources.cpu,
    memory: profile?.memory ?? resources.memory,
    ingressHost: profile?.ingressHost ?? `${slug(suggestion.appName)}.example.com`,
    source: profile?.source ?? `${suggestion.source} + Kubernetes defaults`,
    confidence: Math.min(profile ? suggestion.confidence + 0.01 : suggestion.confidence, 0.99),
    description: profile?.description ?? `${suggestion.description} Kubernetes defaults use namespace production, inferred replicas, resource requests/limits, ingress host, and placeholder secrets.`,
  };
}

function withComposeDefaults(suggestion: ResolveSuggestion, query: string): ResolveSuggestion {
  const normalizedQuery = normalizeKey(query);
  const normalizedName = normalizeKey(suggestion.appName);
  const resources = inferResources(`${normalizedQuery} ${normalizedName}`);

  return {
    ...suggestion,
    namespace: "local",
    replicas: 1,
    cpu: suggestion.cpu ?? resources.cpu,
    memory: suggestion.memory ?? resources.memory,
    ingressHost: "localhost",
    source: `${suggestion.source} + curated Docker Compose profile`,
    confidence: Math.min(suggestion.confidence + 0.01, 0.99),
    description: `${suggestion.description} Docker Compose stack defaults favor local validation with namespace local, one replica, local port mapping, and placeholder secrets only.`,
  };
}

function withHelmDefaults(suggestion: ResolveSuggestion, query: string): ResolveSuggestion {
  const normalizedQuery = normalizeKey(query);
  const normalizedName = normalizeKey(suggestion.appName);
  const workloadName = `${normalizedQuery} ${normalizedName}`;
  const resources = inferResources(workloadName);
  const replicas = inferReplicas(workloadName) === 1 ? 1 : 3;

  return {
    ...withKubernetesDefaults(suggestion, query),
    namespace: "production",
    replicas,
    cpu: resources.cpu,
    memory: resources.memory,
    source: `${suggestion.source} + curated Helm chart starter profile`,
    confidence: Math.min(suggestion.confidence + 0.02, 0.99),
    description: `${suggestion.description} Helm starter defaults target values.yaml/chart scaffolding with production namespace, ${replicas} replica${replicas === 1 ? "" : "s"}, resource values, ingress, and placeholder secrets.`,
  };
}

function withGithubActionsDefaults(suggestion: ResolveSuggestion, query: string): ResolveSuggestion {
  const normalizedQuery = normalizeKey(query);
  const normalizedName = normalizeKey(suggestion.appName);
  const resources = inferResources(`${normalizedQuery} ${normalizedName}`);
  const shouldUseGhcr = suggestion.registry !== "docker.io" || suggestion.image.startsWith(`${slug(suggestion.appName)}:`);

  return {
    ...suggestion,
    registry: shouldUseGhcr ? "ghcr.io" : suggestion.registry,
    namespace: "production",
    replicas: inferReplicas(`${normalizedQuery} ${normalizedName}`),
    cpu: suggestion.cpu ?? resources.cpu,
    memory: suggestion.memory ?? resources.memory,
    ingressHost: `${slug(suggestion.appName)}.example.com`,
    source: `${suggestion.source} + curated GitHub Actions workflow profile`,
    confidence: Math.min(suggestion.confidence + 0.01, 0.99),
    description: `${suggestion.description} GitHub Actions defaults are shaped for a build, push, and deploy workflow with GHCR where appropriate, Kubernetes apply, and placeholder secret keys only.`,
  };
}

function runtimeDefaultsFor(preset: Preset | undefined) {
  if (preset === "python") {
    return {
      port: 8000,
      healthPath: "/healthz",
      envVars: "PYTHONUNBUFFERED=1\nAPP_ENV=production",
      secrets: "APP_SECRET_KEY=change-me",
    };
  }
  if (preset === "go") {
    return {
      port: 8080,
      healthPath: "/ready",
      envVars: "GIN_MODE=release\nLOG_LEVEL=info",
      secrets: "APP_SECRET=change-me",
    };
  }
  if (preset === "static") {
    return {
      port: 80,
      healthPath: "/",
      envVars: "CACHE_CONTROL=max-age=3600",
      secrets: "BASIC_AUTH_PASSWORD=change-me",
    };
  }
  return {
    port: 3000,
    healthPath: "/health",
    envVars: "NODE_ENV=production\nLOG_LEVEL=info",
    secrets: "SESSION_SECRET=change-me",
  };
}

function runtimeBaseSuggestion(query: string): ResolveSuggestion {
  const normalizedQuery = normalizeKey(query);
  const preset = inferPreset(normalizedQuery) ?? "node";
  const appName = slug(normalizedQuery);
  const defaults = runtimeDefaultsFor(preset);

  return {
    appName,
    image: `${appName}:latest`,
    registry: "ghcr.io/acme",
    port: defaults.port,
    healthPath: defaults.healthPath,
    envVars: defaults.envVars,
    secrets: defaults.secrets,
    source: "local runtime inference",
    confidence: 0.7,
    description: `Local ${preset} runtime defaults inferred from the request without external registry lookup.`,
    preset,
  };
}

function withRuntimeDefaults(suggestion: ResolveSuggestion, query: string): ResolveSuggestion {
  const normalizedQuery = normalizeKey(query);
  const normalizedName = normalizeKey(suggestion.appName);
  const preset = suggestion.preset ?? inferPreset(`${normalizedQuery} ${normalizedName}`) ?? "node";
  const defaults = runtimeDefaultsFor(preset);
  const appName = slug(suggestion.appName || query);

  return {
    ...suggestion,
    appName,
    image: `${appName}:latest`,
    registry: "ghcr.io/acme",
    port: defaults.port,
    healthPath: defaults.healthPath,
    envVars: defaults.envVars,
    secrets: defaults.secrets,
    preset,
    namespace: "production",
    replicas: preset === "static" ? 2 : 3,
    cpu: preset === "static" ? "100m" : "300m",
    memory: preset === "static" ? "128Mi" : "512Mi",
    ingressHost: `${appName}.example.com`,
    source: `${suggestion.source} + curated runtime starter profile`,
    confidence: Math.min(suggestion.confidence + 0.01, 0.96),
    description: `${suggestion.description} Runtime starter defaults infer a ${preset} package layout with local build image naming, sensible ports/env, Kubernetes-ready replicas, and placeholder secret keys only.`,
  };
}

function applyTargetDefaults(target: ResolveTarget, suggestion: ResolveSuggestion, query: string) {
  if (target === "kubernetes") {
    return withKubernetesDefaults(suggestion, query);
  }
  if (target === "compose") {
    return withComposeDefaults(suggestion, query);
  }
  if (target === "helm") {
    return withHelmDefaults(suggestion, query);
  }
  if (target === "github-actions") {
    return withGithubActionsDefaults(suggestion, query);
  }
  if (target === "runtime") {
    return withRuntimeDefaults(suggestion, query);
  }
  return suggestion;
}

function resolveTargetFromHint(hint: ResolveHint, query: string): ResolveTarget {
  if (hint === "auto") {
    return inferResolveTarget(query);
  }
  if (hint === "app-description") {
    return "runtime";
  }
  return hint;
}

function shouldUseDockerMetadata(hint: ResolveHint, query: string) {
  return hint === "docker" || hasDockerLookupHint(query) || isExplicitDockerImageIdentifier(query);
}

export async function POST(request: Request) {
  let body: ResolveRequest;

  try {
    body = (await request.json()) as ResolveRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  const target = typeof body.target === "string" ? body.target : "auto";

  if (!resolveHints.has(target as ResolveHint)) {
    return NextResponse.json({ error: "source hint must be auto, docker, kubernetes, compose, helm, github-actions, runtime, or app-description." }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ error: "query is required." }, { status: 400 });
  }

  const resolveTarget = resolveTargetFromHint(target as ResolveHint, query);
  const key = normalizeKey(query);
  const baseSuggestion =
    curated[key] ??
    curated[slug(key)] ??
    (shouldUseDockerMetadata(target as ResolveHint, query) ? await resolveFromDockerHub(query) : runtimeBaseSuggestion(query));
  const suggestion = applyTargetDefaults(resolveTarget, baseSuggestion, query);

  return NextResponse.json({
    target: resolveTarget,
    query,
    suggestion,
  });
}
