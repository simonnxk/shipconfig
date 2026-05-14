export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AuthProviderKind = "local-demo" | "oidc" | "saml" | "ldap" | "custom";
export type StorageProviderKind = "local-browser" | "postgres" | "mysql" | "sqlite" | "mongodb" | "s3" | "custom";
export type CloudProviderKind = "aws" | "azure" | "gcp" | "kubernetes" | "docker" | "custom";
export type AgentProviderKind = "local" | "remote" | "ci" | "custom";

export interface AuthIdentity {
  id: string;
  providerKind: AuthProviderKind;
  providerSubject: string;
  displayName: string;
  email?: string;
  groups?: string[];
  metadata?: Record<string, JsonValue>;
}

export interface AuthSession {
  id: string;
  identityId: string;
  issuedAt: string;
  expiresAt?: string;
  claims?: Record<string, JsonValue>;
}

export interface Team {
  id: string;
  slug: string;
  name: string;
  externalGroupId?: string;
  metadata?: Record<string, JsonValue>;
}

export interface TeamMembership {
  teamId: string;
  identityId: string;
  role: "owner" | "admin" | "editor" | "reviewer" | "viewer";
  source: "local" | "oidc-group" | "saml-attribute" | "ldap-group" | "scim" | "custom";
}

export interface Workspace {
  id: string;
  teamId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, JsonValue>;
}

export interface WorkspaceSnapshot {
  schemaVersion: number;
  services: JsonValue[];
  activeServiceId: string;
  mode?: string;
  resolveTarget?: string;
  resolveQuery?: string;
  theme?: string;
  metadata?: Record<string, JsonValue>;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  createdByIdentityId: string;
  snapshot: WorkspaceSnapshot;
}

export interface Project {
  id: string;
  workspaceId: string;
  teamId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeVersionId?: string;
  versions: ProjectVersion[];
  metadata?: Record<string, JsonValue>;
}

export interface Preset {
  id: string;
  workspaceId: string;
  teamId: string;
  name: string;
  scope: "service" | "workspace";
  createdAt: string;
  updatedAt: string;
  payload: JsonValue;
  metadata?: Record<string, JsonValue>;
}

export interface AuthAdapter {
  kind: AuthProviderKind;
  getCurrentIdentity(): Promise<AuthIdentity | null>;
  signIn(options?: Record<string, JsonValue>): Promise<AuthSession>;
  signOut(sessionId?: string): Promise<void>;
  resolveMemberships(identity: AuthIdentity): Promise<TeamMembership[]>;
}

export interface StorageAdapter {
  kind: StorageProviderKind;
  listTeams(identityId: string): Promise<Team[]>;
  listProjects(workspaceId: string): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | null>;
  saveProject(project: Project): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  listPresets(workspaceId: string): Promise<Preset[]>;
  savePreset(preset: Preset): Promise<Preset>;
  deletePreset(presetId: string): Promise<void>;
}

export interface ClientStateAdapter<TState = unknown> {
  kind: StorageProviderKind;
  loadState(): Promise<TState | null>;
  saveState(state: TState): Promise<void>;
}

export interface PlatformAdapters {
  auth: AuthAdapter;
  storage: StorageAdapter;
}

export interface AgentTask {
  id: string;
  workspaceId: string;
  projectId?: string;
  type: "resolve" | "drift-detect" | "policy-check" | "ai-assist" | "cloud-import";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  input: JsonValue;
  output?: JsonValue;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAdapter {
  kind: AgentProviderKind;
  enqueue(task: AgentTask): Promise<AgentTask>;
  getTask(taskId: string): Promise<AgentTask | null>;
  cancelTask(taskId: string): Promise<void>;
}

export interface CloudResourceRef {
  providerKind: CloudProviderKind;
  accountId?: string;
  region?: string;
  resourceType: string;
  resourceId: string;
  labels?: Record<string, string>;
}

export interface CloudAdapter {
  kind: CloudProviderKind;
  listContainerWorkloads(scope: Record<string, JsonValue>): Promise<CloudResourceRef[]>;
  readWorkload(ref: CloudResourceRef): Promise<WorkspaceSnapshot>;
  planApply(snapshot: WorkspaceSnapshot, scope: Record<string, JsonValue>): Promise<JsonValue>;
}

export interface DriftDetector {
  compare(desired: WorkspaceSnapshot, observed: WorkspaceSnapshot): Promise<JsonValue>;
}
