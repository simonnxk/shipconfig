# ShipConfig Architecture

ShipConfig keeps Phase 1 free and local-first while preparing the codebase for paid workspace, team, and agent-backed workflows. The product must stay provider-neutral: storage and authentication are adapters, not assumptions about one database, identity provider, or hosting platform.

## Phases

### Phase 1: Free Workbench

- Browser-first config generation for Dockerfile, Compose, Kubernetes, Helm, GitHub Actions, validation scripts, and generated README content.
- No required signup.
- Local browser persistence for the active workbench.
- Share links through serialized URL state.
- `/api/resolve` for Auto Resolve metadata inference. The rest of the core workflow remains usable without accounts.

### Phase 2: Pro Workspace

- Optional local/demo account identity and team switcher.
- Saved projects with version snapshots.
- Project and version diff review.
- Reusable preset library.
- Review/share actions that build on the existing share-link flow.
- Local durable storage for the first implementation, behind contracts that can later move to a BYO database.

### Phase 3: Enterprise and Agents

- Enterprise auth through LDAP, OIDC, SAML, SCIM, or custom adapters.
- BYO database/storage adapters for Postgres, MySQL, SQLite, MongoDB, S3-compatible object stores, or internal platforms.
- Server agents for resolver enrichment, drift detection, policy checks, AI-assisted config review, and cloud import.
- Multi-cloud adapters for AWS, Azure, GCP, Kubernetes, Docker, and private infrastructure.

## Adapter Contracts

Type-only contracts live in `src/types/platform.ts` and are intentionally dependency-free.

- `AuthAdapter` resolves local/demo, OIDC, SAML, LDAP, or custom identities into `AuthIdentity` and `TeamMembership`.
- `StorageAdapter` owns teams, projects, versions, presets, and workspace records without dictating a database.
- `ClientStateAdapter` is the browser/local persistence boundary used by the Phase 2 local-first adapter so UI state does not call `localStorage` directly.
- `AgentAdapter` schedules future background jobs such as drift detection, policy checks, resolver enrichment, and AI assist.
- `CloudAdapter` imports observed workloads and plans changes for cloud or cluster targets.
- `DriftDetector` compares desired ShipConfig snapshots with observed infrastructure snapshots.

## Data Model

- `Team` is the organization boundary.
- `Workspace` groups projects under a team.
- `Project` is a named saved config bundle.
- `ProjectVersion` stores immutable workbench snapshots with author, timestamp, and label metadata.
- `Preset` stores reusable service or workspace shapes.
- `WorkspaceSnapshot` is the portable generated-config state that can move between local browser storage, BYO databases, review links, and server agents.
- Serialized snapshots and presets must redact `ServiceConfig.secrets` values to safe placeholders while preserving existing bracketed placeholders such as `[DATABASE_URL_PLACEHOLDER]`.

## Server Agent Plan

Server agents should be optional and queued through `AgentAdapter`.

- Resolver agent: enrich image/runtime metadata without blocking the editor.
- Drift agent: fetch observed cloud/cluster state through `CloudAdapter` and compare against saved versions.
- Policy agent: evaluate generated manifests for enterprise policy packs.
- AI assist agent: explain diffs, recommend safer defaults, and draft migration steps without changing user state automatically.
- Export agent: generate larger bundles, signed archives, or repository pull requests.

## BYO Auth and Database

Phase 2 uses the local-first adapter in `src/lib/platform/local-first.ts`. That adapter provides a local demo `AuthAdapter`, team membership resolution, and browser-backed `ClientStateAdapter` persistence. Future hosted or enterprise deployments should implement `AuthAdapter`, `StorageAdapter`, and any needed client-state persistence for the chosen environment. No UI or domain model should assume Supabase-specific users, row-level security policies, storage buckets, or Postgres-only behavior. Supabase can be one adapter later, but it cannot be the platform contract.

## Drift Detection and Multi-Cloud

Drift detection compares a saved `ProjectVersion.snapshot` with observed state imported from a `CloudAdapter`. Multi-cloud support should normalize provider-specific container services, Kubernetes workloads, ingress/load balancers, secrets references, resources, and environment configuration into `WorkspaceSnapshot` or explicit diff records.
