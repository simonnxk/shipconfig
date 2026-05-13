import { NextResponse } from "next/server";

type Preset = "node" | "python" | "go" | "static";

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

function withLatestTag(image: string) {
  const lastSlash = image.lastIndexOf("/");
  const lastColon = image.lastIndexOf(":");
  return lastColon > lastSlash ? image : `${image}:latest`;
}

function inferPreset(name: string): Preset | undefined {
  if (["node", "next", "express"].some((part) => name.includes(part))) {
    return "node";
  }
  if (["python", "django", "fastapi", "flask"].some((part) => name.includes(part))) {
    return "python";
  }
  if (["nginx", "httpd", "caddy"].some((part) => name.includes(part))) {
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

export async function POST(request: Request) {
  let body: ResolveRequest;

  try {
    body = (await request.json()) as ResolveRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  const target = typeof body.target === "string" ? body.target : "";

  if (target !== "docker") {
    return NextResponse.json({ error: "Only target=docker is supported." }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ error: "query is required." }, { status: 400 });
  }

  const key = normalizeKey(query);
  const suggestion = curated[key] ?? curated[slug(key)] ?? (await resolveFromDockerHub(query));

  return NextResponse.json({
    target: "docker",
    query,
    suggestion,
  });
}
