import type { Theme } from "./theme";

export type { Theme } from "./theme";

export type ChangeScope =
  | "conflict"
  | "staged"
  | "working"
  | "untracked"
  | "commit"
  | "stash";
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

export interface Preferences {
  theme: Theme;
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
  groupId: string;
  groupName: string;
  remoteIdentity: string | null;
  isPrimaryWorktree: boolean;
  favourite: boolean;
  archived: boolean;
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

export interface PullRequestSummary {
  repository: string;
  number: number;
  title: string;
  author: string;
  isDraft: boolean;
  updatedAt: string;
  url: string;
}

export interface PullRequestsResponse {
  generatedAt: string;
  account: string;
  repositoryCount: number;
  skippedRepositories: string[];
  createdByMe: PullRequestSummary[];
  reviewRequested: PullRequestSummary[];
}

export interface WorkspaceFile {
  repositoryId: string;
  path: string;
}

export interface WorkspaceFilesResponse {
  generatedAt: string;
  files: WorkspaceFile[];
  errors: Array<{ repositoryId: string; error: string }>;
  truncated: boolean;
}

export type AppShortcut = "quick-open" | "find";

export interface ChangeItem {
  id: string;
  path: string;
  previousPath: string | null;
  scope: ChangeScope;
  kind: ChangeKind;
  status: string;
}

export type ChangeAction = "stage" | "unstage" | "revert";
export type ChangeActionScope =
  | Exclude<ChangeScope, "commit" | "stash">
  | "unstaged";

export interface ChangeSelection {
  scope: ChangeActionScope;
  path?: string | null;
  paths?: string[];
}

export interface ChangeMutationResult {
  repositoryId: string;
  changes: ChangeItem[];
  cancelled?: boolean;
}

export interface StagedCommitFile {
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
  status: string;
}

export interface CommitContext {
  repositoryId: string;
  snapshotId: string;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  stagedFiles: StagedCommitFile[];
}

export interface CommitResult {
  repositoryId: string;
  commit: Commit;
  changes: ChangeItem[];
}

export type AiProvider = "codex" | "claude";
export type AiTerminalAction = "install" | "login";

export interface AiModel {
  id: string;
  label: string;
  description: string;
}

export interface AiProviderStatus {
  id: AiProvider;
  label: string;
  available: boolean;
  authenticated: boolean;
  executablePath: string | null;
  version: string | null;
  models: AiModel[];
  error: string | null;
}

export interface AiStatus {
  provider: AiProvider;
  model: string;
  selectedModels: Record<AiProvider, string>;
  disclosureAccepted: boolean;
  providers: Record<AiProvider, AiProviderStatus>;
}

export interface GeneratedCommitMessage {
  message: string;
  snapshotId: string;
  patchTruncated: boolean;
  provider: AiProvider;
  model: string;
}

export interface FileChange {
  status: string;
  path: string;
  previousPath: string | null;
}

export interface StashSummary {
  id: string;
  ref: string;
  subject: string;
  message: string;
  branch: string | null;
  createdAt: string;
  fileCount: number;
}

export interface StashDetails {
  repositoryId: string;
  stash: StashSummary;
  files: FileChange[];
}

export interface StashCreateInput {
  message: string;
  includeUntracked: boolean;
  path?: string | null;
}

export interface StashCreateResult {
  repositoryId: string;
  stash: StashSummary;
  changes: ChangeItem[];
  remainingFiles: number;
}

export interface StashMutationResult {
  repositoryId: string;
  outcome: "applied" | "conflicts" | "cancelled";
  stashRetained: boolean;
  changes: ChangeItem[];
}

export interface StashDropResult {
  repositoryId: string;
  stashId: string;
  dropped: boolean;
  cancelled?: boolean;
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

export interface RepositoryBranch {
  name: string;
  ref: string;
  remote: boolean;
  current: boolean;
}

export interface RepositoryBranches {
  repositoryId: string;
  local: RepositoryBranch[];
  remote: RepositoryBranch[];
}

export interface BranchSwitchResult {
  repositoryId: string;
  requiresStash: boolean;
  cancelled: boolean;
  stashed?: { ref: string; message: string } | null;
  repository?: RepositorySummary;
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

export type RepositoryTab = "changes" | "commits" | "files" | "stashes";
export type CommitScope = "local" | "incoming" | "outgoing";

export interface LocalStatusBridge {
  workspace: {
    getCurrent(): Promise<WorkspaceState>;
    choose(): Promise<WorkspaceState | null>;
    openRecent(path: string): Promise<WorkspaceState | null>;
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
    workspaceFiles(): Promise<WorkspaceFilesResponse>;
    comparison(
      repositoryId: string,
      options: {
        path: string;
        previousPath?: string | null;
        scope: ChangeScope;
        commit?: string | null;
        stash?: string | null;
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
    prepareCommit(repositoryId: string): Promise<CommitContext>;
    createCommit(
      repositoryId: string,
      input: { message: string; snapshotId: string },
    ): Promise<CommitResult>;
    stage(
      repositoryId: string,
      selection: ChangeSelection,
    ): Promise<ChangeMutationResult>;
    unstage(
      repositoryId: string,
      selection: ChangeSelection,
    ): Promise<ChangeMutationResult>;
    revert(
      repositoryId: string,
      selection: ChangeSelection,
    ): Promise<ChangeMutationResult>;
    stashes(
      repositoryId: string,
    ): Promise<{ repositoryId: string; stashes: StashSummary[] }>;
    stash(
      repositoryId: string,
      stashId: string,
    ): Promise<StashDetails>;
    createStash(
      repositoryId: string,
      input: StashCreateInput,
    ): Promise<StashCreateResult>;
    applyStash(
      repositoryId: string,
      stashId: string,
    ): Promise<StashMutationResult>;
    popStash(
      repositoryId: string,
      stashId: string,
    ): Promise<StashMutationResult>;
    dropStash(
      repositoryId: string,
      stashId: string,
    ): Promise<StashDropResult>;
    sync(repositoryId: string): Promise<{
      repositoryId: string;
      upstream: string;
      pulled: number;
      pushed: number;
      incoming: number;
      outgoing: number;
      syncedAt: string;
    }>;
    scripts(repositoryId: string): Promise<{
      repositoryId: string;
      scripts: RepositoryScript[];
    }>;
    setFavourite(
      groupId: string,
      favourite: boolean,
    ): Promise<RepositoriesResponse>;
    setArchived(
      groupId: string,
      archived: boolean,
    ): Promise<RepositoriesResponse>;
    branches(repositoryId: string): Promise<RepositoryBranches>;
    switchBranch(
      repositoryId: string,
      targetRef: string,
    ): Promise<BranchSwitchResult>;
  };
  pullRequests: {
    list(): Promise<PullRequestsResponse>;
    open(url: string): Promise<void>;
  };
  preferences: {
    get(): Promise<Preferences>;
    setTheme(theme: Theme): Promise<Preferences>;
  };
  shortcuts: {
    onRequest(callback: (shortcut: AppShortcut) => void): void;
    offRequest(callback: (shortcut: AppShortcut) => void): void;
  };
  ai: {
    status(): Promise<AiStatus>;
    setPreferences(provider: AiProvider, model: string): Promise<AiStatus>;
    chooseExecutable(provider: AiProvider): Promise<AiStatus>;
    acceptDisclosure(provider: AiProvider): Promise<boolean>;
    generateCommitMessage(input: {
      repositoryId: string;
      snapshotId: string;
      requestId: string;
    }): Promise<GeneratedCommitMessage>;
    cancelGeneration(requestId: string): Promise<boolean>;
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
