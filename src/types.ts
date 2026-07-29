export type ChangeScope = "conflict" | "staged" | "working" | "untracked" | "commit";
export type ChangeKind =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "type-changed"
  | "conflict"
  | "untracked";

export interface Workspace {
  path: string;
  name: string;
}

export interface WorkspaceState {
  current: Workspace | null;
  recent: Workspace[];
}

export interface Commit {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  subject: string;
  refs?: string;
  body?: string;
}

export interface RepositorySummary {
  id: string;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  headSha: string | null;
  upstream: string | null;
  incoming: number;
  outgoing: number;
  summary: {
    files: number;
    staged: number;
    modified: number;
    untracked: number;
    conflicts: number;
  };
  latestCommit: Commit | null;
  fetchedAt: string | null;
  scannedAt: string;
  error: string | null;
}

export interface RepositoriesResponse {
  generatedAt: string;
  workspaceName: string;
  repositories: RepositorySummary[];
}

export interface ChangeItem {
  id: string;
  path: string;
  previousPath: string | null;
  scope: ChangeScope;
  kind: ChangeKind;
  status: string;
}

export interface FileChange {
  status: string;
  path: string;
  previousPath: string | null;
}

export interface ComparisonSide {
  content: string;
  source: string;
  label: string;
  binary: boolean;
  truncated: boolean;
  missing: boolean;
}

export interface Comparison {
  repositoryId: string;
  path: string;
  previousPath: string | null;
  language: string;
  original: ComparisonSide;
  modified: ComparisonSide;
}

export interface Listener {
  process: string;
  pid: number | null;
  port: number;
  address: string;
}

export interface LocalStatus {
  generatedAt: string;
  listeners: Listener[];
}

export interface RepositoryScript {
  name: string;
  runner: "npm" | "pnpm" | "yarn" | "bun";
  command: string;
  args: string[];
}

export interface ServiceProfile {
  id: string;
  repositoryId: string;
  name: string;
  executable: string;
  args: string[];
  cwdRelative: string;
}

export type TerminalStatus = "running" | "exited" | "failed" | "stopping";
export type TerminalKind = "shell" | "script" | "profile";

export interface TerminalSession {
  id: string;
  repositoryId: string;
  title: string;
  kind: TerminalKind;
  status: TerminalStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | null;
  truncated: boolean;
  buffer: string;
}

export type TerminalEvent =
  | { type: "created" | "updated"; session: TerminalSession }
  | { type: "output"; sessionId: string; data: string; truncated: boolean }
  | { type: "removed"; sessionId: string };

export type RepositoryTab = "changes" | "commits" | "files";
export type CommitScope = "local" | "incoming" | "outgoing";

export interface LocalStatusBridge {
  workspace: {
    getCurrent(): Promise<WorkspaceState>;
    choose(): Promise<WorkspaceState>;
    openRecent(path: string): Promise<WorkspaceState>;
  };
  repositories: {
    list(): Promise<RepositoriesResponse>;
    changes(repositoryId: string): Promise<{ repositoryId: string; changes: ChangeItem[] }>;
    commits(
      repositoryId: string,
      scope: CommitScope,
    ): Promise<{ repositoryId: string; scope: CommitScope; commits: Commit[] }>;
    commit(
      repositoryId: string,
      sha: string,
    ): Promise<{ repositoryId: string; commit: Commit; files: FileChange[] }>;
    files(repositoryId: string): Promise<{ repositoryId: string; files: string[] }>;
    comparison(
      repositoryId: string,
      options: {
        path: string;
        previousPath?: string | null;
        scope: ChangeScope;
        commit?: string | null;
      },
    ): Promise<Comparison>;
    fetch(repositoryId: string): Promise<{
      repositoryId: string;
      remote: string;
      fetchedAt: string;
    }>;
    fetchAll(): Promise<{
      fetchedAt: string;
      results: Array<{
        ok: boolean;
        repositoryId: string;
        remote?: string;
        error?: string;
      }>;
    }>;
    scripts(repositoryId: string): Promise<{
      repositoryId: string;
      scripts: RepositoryScript[];
    }>;
  };
  profiles: {
    list(): Promise<ServiceProfile[]>;
    save(profile: Omit<ServiceProfile, "id"> & { id?: string }): Promise<ServiceProfile[]>;
    remove(profileId: string): Promise<ServiceProfile[]>;
  };
  terminals: {
    list(): Promise<TerminalSession[]>;
    create(input: {
      repositoryId: string;
      kind: TerminalKind;
      scriptName?: string;
      profileId?: string;
    }): Promise<TerminalSession>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    stop(sessionId: string): Promise<void>;
    restart(sessionId: string): Promise<TerminalSession>;
    rename(sessionId: string, title: string): Promise<TerminalSession>;
    close(sessionId: string): Promise<void>;
    onEvent(callback: (event: TerminalEvent) => void): void;
    offEvent(callback: (event: TerminalEvent) => void): void;
  };
  system: {
    listeners(): Promise<LocalStatus>;
    openLocalUrl(url: string): Promise<void>;
  };
}

declare global {
  interface Window {
    localStatus: LocalStatusBridge;
  }
}
