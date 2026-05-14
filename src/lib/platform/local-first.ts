import type { AuthAdapter, AuthIdentity, AuthSession, ClientStateAdapter, StorageAdapter, Team, TeamMembership } from "@/types/platform";

const PRO_WORKSPACE_STATE_KEY = "shipconfig.proWorkspace.v1";

const localIdentity: AuthIdentity = {
  id: "acct-local-demo",
  providerKind: "local-demo",
  providerSubject: "local-demo",
  displayName: "Local Demo User",
  email: "local-demo@shipconfig.local",
};

const localTeams: Team[] = [
  { id: "team-personal", name: "Personal Workspace", slug: "personal" },
  { id: "team-platform", name: "Platform Team", slug: "platform" },
];

const localMemberships: TeamMembership[] = [
  { teamId: "team-personal", identityId: localIdentity.id, role: "owner", source: "local" },
  { teamId: "team-platform", identityId: localIdentity.id, role: "admin", source: "local" },
];

export interface ProWorkspaceStorageAdapter extends Pick<StorageAdapter, "kind" | "listTeams">, ClientStateAdapter<unknown> {}

export interface ProWorkspaceAdapters {
  auth: AuthAdapter;
  storage: ProWorkspaceStorageAdapter;
}

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createLocalAuthAdapter(): AuthAdapter {
  return {
    kind: "local-demo",
    async getCurrentIdentity() {
      return { ...localIdentity };
    },
    async signIn(): Promise<AuthSession> {
      return {
        id: "session-local-demo",
        identityId: localIdentity.id,
        issuedAt: new Date().toISOString(),
      };
    },
    async signOut() {
      return undefined;
    },
    async resolveMemberships(identity) {
      return localMemberships
        .filter((membership) => membership.identityId === identity.id)
        .map((membership) => ({ ...membership }));
    },
  };
}

function createLocalStorageAdapter(): ProWorkspaceStorageAdapter {
  return {
    kind: "local-browser",
    async listTeams() {
      return localTeams.map((team) => ({ ...team }));
    },
    async loadState() {
      const storage = getBrowserStorage();
      if (!storage) {
        return null;
      }

      const raw = storage.getItem(PRO_WORKSPACE_STATE_KEY);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    async saveState(state) {
      const storage = getBrowserStorage();
      if (!storage) {
        throw new Error("Local browser storage is unavailable.");
      }

      storage.setItem(PRO_WORKSPACE_STATE_KEY, JSON.stringify(state));
    },
  };
}

export function createLocalFirstProWorkspaceAdapters(): ProWorkspaceAdapters {
  return {
    auth: createLocalAuthAdapter(),
    storage: createLocalStorageAdapter(),
  };
}
