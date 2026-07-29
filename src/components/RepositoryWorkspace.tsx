import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Binary,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  CloudDownload,
  Code2,
  File,
  FileCode2,
  FileQuestion,
  Files,
  GitCommitHorizontal,
  GitBranch,
  GitCompareArrows,
  History,
  Menu,
  RefreshCw,
  Search,
  SquareTerminal,
  Play,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { api } from "../api";
import { routeParams, updateRoute } from "../route";
import type {
  ChangeItem,
  ChangeScope,
  Commit,
  CommitScope,
  Comparison,
  FileChange,
  RepositoriesResponse,
  RepositorySummary,
  RepositoryTab,
  RepositoryScript,
  TerminalKind,
} from "../types";
import { FileTree } from "./FileTree";

const MonacoDiff = lazy(() => import("./MonacoDiff"));

type RepoFilter = "all" | "changed" | "incoming" | "outgoing" | "errors";

interface CompareRequest {
  path: string;
  previousPath?: string | null;
  scope: ChangeScope;
  commit?: string | null;
}

function getParams() {
  return routeParams();
}

function initialTab(): RepositoryTab {
  const value = getParams().get("tab");
  return value === "commits" || value === "files" ? value : "changes";
}

function initialCompare(): CompareRequest | null {
  const path = getParams().get("file");
  if (!path) return null;
  const scope = getParams().get("scope") as ChangeScope | null;
  return {
    path,
    scope:
      scope && ["staged", "working", "untracked", "conflict", "commit"].includes(scope)
        ? scope
        : "working",
    commit: getParams().get("commit"),
  };
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "Not available";
  const difference = Date.now() - new Date(value).getTime();
  const seconds = Math.round(difference / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ago`;
}

function exactDate(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function pathName(path: string) {
  return path.split("/").pop() || path;
}

function pathDirectory(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function repositoryPassesFilter(repository: RepositorySummary, filter: RepoFilter) {
  if (filter === "changed") return repository.summary.files > 0;
  if (filter === "incoming") return repository.incoming > 0;
  if (filter === "outgoing") return repository.outgoing > 0;
  if (filter === "errors") return Boolean(repository.error);
  return true;
}

const scopeGroups: Array<{
  scope: ChangeScope;
  label: string;
  description: string;
}> = [
  { scope: "conflict", label: "Conflicts", description: "Needs attention" },
  { scope: "staged", label: "Staged changes", description: "Index" },
  { scope: "working", label: "Working tree", description: "Not staged" },
  { scope: "untracked", label: "Untracked", description: "New files" },
];

const kindLabel = {
  added: "A",
  copied: "C",
  deleted: "D",
  modified: "M",
  renamed: "R",
  "type-changed": "T",
  conflict: "!",
  untracked: "U",
};

function ResizeHandle({
  side,
  onResize,
}: {
  side: "repository" | "context";
  onResize: (delta: number) => void;
}) {
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const move = (moveEvent: PointerEvent) => onResize(moveEvent.clientX - startX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      onPointerDown={start}
    />
  );
}

function StatusBadge({
  tone,
  children,
  title,
}: {
  tone: "neutral" | "dirty" | "incoming" | "outgoing" | "danger";
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={`status-badge status-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

function RepositoryNavigator({
  repositories,
  selectedId,
  onSelect,
  mobileOpen,
  onCloseMobile,
  searchInputRef,
}: {
  repositories: RepositorySummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RepoFilter>("all");
  const filtered = useMemo(
    () =>
      repositories.filter(
        (repository) =>
          repository.id.toLowerCase().includes(query.toLowerCase()) &&
          repositoryPassesFilter(repository, filter),
      ),
    [filter, query, repositories],
  );

  return (
    <aside className={`repo-panel ${mobileOpen ? "is-mobile-open" : ""}`}>
      <div className="panel-titlebar">
        <div>
          <span className="panel-kicker">Workspace</span>
          <strong>Repositories</strong>
        </div>
        <button
          className="icon-button mobile-only"
          type="button"
          onClick={onCloseMobile}
          aria-label="Close repositories"
        >
          <X size={17} />
        </button>
      </div>
      <label className="panel-search">
        <Search size={14} />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a repository"
          aria-label="Find a repository"
        />
        <kbd>⌘P</kbd>
      </label>
      <div className="filter-strip" aria-label="Filter repositories">
        {(["all", "changed", "incoming", "outgoing"] as RepoFilter[]).map((value) => (
          <button
            type="button"
            key={value}
            className={filter === value ? "is-active" : ""}
            onClick={() => setFilter(value)}
          >
            {value === "all" ? "All" : value}
          </button>
        ))}
      </div>
      <div className="repository-list" role="listbox" aria-label="Repositories">
        {filtered.map((repository) => (
          <button
            type="button"
            role="option"
            aria-selected={repository.id === selectedId}
            className={`repository-row ${
              repository.id === selectedId ? "is-selected" : ""
            }`}
            key={repository.id}
            onClick={() => {
              onSelect(repository.id);
              onCloseMobile();
            }}
          >
            <span
              className={`repo-health-dot ${
                repository.error
                  ? "has-error"
                  : repository.summary.conflicts
                    ? "has-conflict"
                    : repository.summary.files
                      ? "has-changes"
                      : "is-clean"
              }`}
            />
            <span className="repository-row__content">
              <span className="repository-row__name">{repository.id}</span>
              <span className="repository-row__branch">
                <GitBranch size={11} />
                {repository.detached
                  ? "Detached HEAD"
                  : repository.branch || (repository.unborn ? "No commits yet" : "Unknown")}
              </span>
            </span>
            <span className="repository-row__signals">
              {repository.summary.files > 0 && (
                <StatusBadge tone="dirty">{repository.summary.files}</StatusBadge>
              )}
              {repository.incoming > 0 && (
                <StatusBadge tone="incoming" title="Incoming commits">
                  <ArrowDown size={10} />
                  {repository.incoming}
                </StatusBadge>
              )}
              {repository.outgoing > 0 && (
                <StatusBadge tone="outgoing" title="Outgoing commits">
                  <ArrowUp size={10} />
                  {repository.outgoing}
                </StatusBadge>
              )}
            </span>
          </button>
        ))}
        {!filtered.length && (
          <div className="panel-empty">
            <Search size={20} />
            <strong>No repositories found</strong>
            <span>Try another name or filter.</span>
          </div>
        )}
      </div>
      <div className="panel-foot">
        <span className="privacy-dot" />
        Local Git data only
      </div>
    </aside>
  );
}

function ChangeList({
  changes,
  selected,
  search,
  onSelect,
}: {
  changes: ChangeItem[];
  selected: CompareRequest | null;
  search: string;
  onSelect: (change: ChangeItem) => void;
}) {
  const filtered = changes.filter((change) =>
    change.path.toLowerCase().includes(search.toLowerCase()),
  );
  if (!filtered.length) {
    return (
      <div className="panel-empty panel-empty--large">
        <Check size={24} />
        <strong>{changes.length ? "No matching files" : "Working tree clean"}</strong>
        <span>
          {changes.length
            ? "Try a different file name."
            : "There are no local changes in this repository."}
        </span>
      </div>
    );
  }
  return (
    <div className="change-groups">
      {scopeGroups.map((group) => {
        const items = filtered.filter((change) => change.scope === group.scope);
        if (!items.length) return null;
        return (
          <details className="change-group" open key={group.scope}>
            <summary>
              <ChevronDown size={13} />
              <span>{group.label}</span>
              <small>{group.description}</small>
              <strong>{items.length}</strong>
            </summary>
            <div>
              {items.map((change) => (
                <button
                  type="button"
                  className={`change-row ${
                    selected?.path === change.path && selected.scope === change.scope
                      ? "is-selected"
                      : ""
                  }`}
                  key={change.id}
                  onClick={() => onSelect(change)}
                  title={change.path}
                >
                  <span className={`change-kind change-kind--${change.kind}`}>
                    {kindLabel[change.kind]}
                  </span>
                  <span className="change-path">
                    <strong>{pathName(change.path)}</strong>
                    <small>
                      {change.previousPath
                        ? `${change.previousPath} → ${pathDirectory(change.path)}`
                        : pathDirectory(change.path) || "repository root"}
                    </small>
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function CommitList({
  commits,
  selectedSha,
  onSelect,
}: {
  commits: Commit[];
  selectedSha: string | null;
  onSelect: (commit: Commit) => void;
}) {
  if (!commits.length) {
    return (
      <div className="panel-empty panel-empty--large">
        <History size={24} />
        <strong>No commits here</strong>
        <span>This range does not contain any commits.</span>
      </div>
    );
  }
  return (
    <div className="commit-list">
      {commits.map((commit) => (
        <button
          type="button"
          className={`commit-row ${commit.sha === selectedSha ? "is-selected" : ""}`}
          key={commit.sha}
          onClick={() => onSelect(commit)}
        >
          <span className="commit-node">
            <span />
          </span>
          <span className="commit-row__content">
            <strong>{commit.subject}</strong>
            <span>
              {commit.author} · {relativeTime(commit.authoredAt)}
            </span>
            <code>{commit.shortSha}</code>
          </span>
        </button>
      ))}
    </div>
  );
}

export function RepositoryWorkspace({
  data,
  loading,
  error,
  onRefresh,
  onStartTerminal,
}: {
  data: RepositoriesResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onStartTerminal: (
    repositoryId: string,
    kind: TerminalKind,
    option?: string,
  ) => Promise<void>;
}) {
  const repositories = useMemo(() => data?.repositories ?? [], [data?.repositories]);
  const params = getParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      params.get("repo") ||
      window.localStorage.getItem("local-status:selected-repository"),
  );
  const [tab, setTab] = useState<RepositoryTab>(initialTab);
  const [commitScope, setCommitScope] = useState<CommitScope>("local");
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextSearch, setContextSearch] = useState("");
  const [compareRequest, setCompareRequest] = useState<CompareRequest | null>(
    initialCompare,
  );
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(
    () => params.get("commit"),
  );
  const [commitDetail, setCommitDetail] = useState<{
    commit: Commit;
    files: FileChange[];
  } | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [repositoryScripts, setRepositoryScripts] = useState<RepositoryScript[]>([]);
  const [scriptsRepositoryId, setScriptsRepositoryId] = useState<string | null>(null);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [repoWidth, setRepoWidth] = useState(
    () => Number(window.localStorage.getItem("local-status:repo-width")) || 264,
  );
  const [contextWidth, setContextWidth] = useState(
    () => Number(window.localStorage.getItem("local-status:context-width")) || 338,
  );
  const resizeStart = useRef({ repo: repoWidth, context: contextWidth });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const runMenuButtonRef = useRef<HTMLButtonElement>(null);
  const contextRequestKey = useRef<string | null>(null);
  const comparisonRequestKey = useRef<string | null>(null);

  const selectedRepository =
    repositories.find((repository) => repository.id === selectedId) ?? null;

  useEffect(() => {
    if (!repositories.length) return;
    if (!selectedId || !repositories.some((repository) => repository.id === selectedId)) {
      const firstChanged =
        repositories.find((repository) => repository.summary.files > 0) ??
        repositories[0];
      setSelectedId(firstChanged.id);
    }
  }, [repositories, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    window.localStorage.setItem("local-status:selected-repository", selectedId);
    const updates: Record<string, string | null | undefined> = {
      view: "repositories",
      repo: selectedId,
      tab,
      terminal: null,
    };
    if (compareRequest) {
      updates.file = compareRequest.path;
      updates.scope = compareRequest.scope;
      updates.commit = compareRequest.commit;
    } else {
      updates.file = null;
      updates.scope = null;
      updates.commit = selectedCommit;
    }
    updateRoute(updates);
  }, [compareRequest, selectedCommit, selectedId, tab]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    setRunMenuOpen(false);
    setTerminalError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!runMenuOpen) return;

    function dismissRunMenu(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        runMenuRef.current?.contains(target) ||
        runMenuButtonRef.current?.contains(target)
      ) {
        return;
      }
      setRunMenuOpen(false);
    }

    function dismissRunMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setRunMenuOpen(false);
      runMenuButtonRef.current?.focus();
    }

    document.addEventListener("pointerdown", dismissRunMenu, true);
    document.addEventListener("keydown", dismissRunMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismissRunMenu, true);
      document.removeEventListener("keydown", dismissRunMenuWithKeyboard);
    };
  }, [runMenuOpen]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const requestKey = `${selectedId}:${tab}:${commitScope}`;
    const changedView = contextRequestKey.current !== requestKey;
    contextRequestKey.current = requestKey;
    if (changedView) setContextLoading(true);
    setContextError(null);
    const load =
      tab === "changes"
        ? api.changes(selectedId)
        : tab === "commits"
          ? api.commits(selectedId, commitScope)
          : api.files(selectedId);
    void load
      .then((response) => {
        if (cancelled) return;
        if ("changes" in response) {
          setChanges(response.changes);
          if (
            compareRequest &&
            !response.changes.some(
              (change) =>
                change.path === compareRequest.path &&
                change.scope === compareRequest.scope,
            )
          ) {
            setCompareRequest(null);
          }
        } else if ("commits" in response) {
          setCommits(response.commits);
          if (
            !selectedCommit ||
            !response.commits.some((commit) => commit.sha === selectedCommit)
          ) {
            setSelectedCommit(response.commits[0]?.sha ?? null);
            setCompareRequest(null);
          }
        } else {
          setFiles(response.files);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setContextError(caught instanceof Error ? caught.message : "Could not load Git data.");
        }
      })
      .finally(() => {
        if (!cancelled && changedView) setContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // compareRequest is intentionally excluded so selecting a file does not reload the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tab, commitScope, data?.generatedAt]);

  useEffect(() => {
    if (!selectedId || !selectedCommit || tab !== "commits") {
      setCommitDetail(null);
      return;
    }
    let cancelled = false;
    void api
      .commit(selectedId, selectedCommit)
      .then((detail) => {
        if (!cancelled) setCommitDetail(detail);
      })
      .catch((caught) => {
        if (!cancelled) {
          setViewerError(caught instanceof Error ? caught.message : "Could not load commit.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCommit, selectedId, tab]);

  useEffect(() => {
    if (!selectedId || !compareRequest) {
      comparisonRequestKey.current = null;
      setComparison(null);
      return;
    }
    let cancelled = false;
    const requestKey = [
      selectedId,
      compareRequest.scope,
      compareRequest.path,
      compareRequest.previousPath,
      compareRequest.commit,
    ].join(":");
    const changedSelection = comparisonRequestKey.current !== requestKey;
    comparisonRequestKey.current = requestKey;
    if (changedSelection) setViewerLoading(true);
    setViewerError(null);
    void api
      .comparison(selectedId, compareRequest)
      .then((result) => {
        if (!cancelled) {
          setComparison((current) =>
            current &&
            current.path === result.path &&
            current.original.content === result.original.content &&
            current.modified.content === result.modified.content &&
            current.original.label === result.original.label &&
            current.modified.label === result.modified.label
              ? current
              : result,
          );
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setComparison(null);
          setViewerError(
            caught instanceof Error ? caught.message : "Could not compare this file.",
          );
        }
      })
      .finally(() => {
        if (!cancelled && changedSelection) setViewerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compareRequest, selectedId, data?.generatedAt]);

  const selectRepository = useCallback((id: string) => {
    setSelectedId(id);
    setTab("changes");
    setCommitScope("local");
    setSelectedCommit(null);
    setCompareRequest(null);
    setContextSearch("");
    setRunMenuOpen(false);
    setRepositoryScripts([]);
    setTerminalError(null);
  }, []);

  async function openRunMenu(repositoryId: string) {
    setTerminalError(null);
    if (runMenuOpen) {
      setRunMenuOpen(false);
      return;
    }
    setRunMenuOpen(true);
    if (scriptsRepositoryId === repositoryId) return;
    setRepositoryScripts([]);
    setScriptsLoading(true);
    try {
      setRepositoryScripts((await api.scripts(repositoryId)).scripts);
      setScriptsRepositoryId(repositoryId);
    } catch (caught) {
      setTerminalError(
        caught instanceof Error ? caught.message : "Could not inspect package scripts.",
      );
    } finally {
      setScriptsLoading(false);
    }
  }

  async function startRepositoryTerminal(
    repositoryId: string,
    kind: TerminalKind,
    option?: string,
  ) {
    setTerminalError(null);
    try {
      await onStartTerminal(repositoryId, kind, option);
      setRunMenuOpen(false);
    } catch (caught) {
      setTerminalError(
        caught instanceof Error ? caught.message : "Could not start the terminal.",
      );
    }
  }

  function selectTab(nextTab: RepositoryTab) {
    setTab(nextTab);
    setCompareRequest(null);
    setSelectedCommit(null);
    setContextSearch("");
  }

  async function fetchRepository(repositoryId: string) {
    setFetching(repositoryId);
    setToast(null);
    try {
      const result = await api.fetch(repositoryId);
      setToast(`Fetched ${result.remote} for ${repositoryId}.`);
      await onRefresh();
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Fetch failed.");
    } finally {
      setFetching(null);
    }
  }

  async function fetchEveryRepository() {
    setFetching("all");
    setToast(null);
    try {
      const result = await api.fetchAll();
      const failures = result.results.filter((entry) => !entry.ok);
      setToast(
        failures.length
          ? `Fetched ${result.results.length - failures.length} repositories; ${failures.length} need attention.`
          : `Fetched all ${result.results.length} repositories.`,
      );
      await onRefresh();
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Fetch all failed.");
    } finally {
      setFetching(null);
    }
  }

  function resizeRepo(delta: number) {
    const next = Math.max(220, Math.min(390, resizeStart.current.repo + delta));
    setRepoWidth(next);
    window.localStorage.setItem("local-status:repo-width", String(next));
  }

  function resizeContext(delta: number) {
    const next = Math.max(280, Math.min(520, resizeStart.current.context + delta));
    setContextWidth(next);
    window.localStorage.setItem("local-status:context-width", String(next));
  }

  function rememberResizeStart() {
    resizeStart.current = { repo: repoWidth, context: contextWidth };
  }

  const stats = useMemo(
    () => ({
      total: repositories.length,
      changed: repositories.filter((repository) => repository.summary.files > 0).length,
      conflicts: repositories.reduce(
        (total, repository) => total + repository.summary.conflicts,
        0,
      ),
      incoming: repositories.reduce(
        (total, repository) => total + repository.incoming,
        0,
      ),
      outgoing: repositories.reduce(
        (total, repository) => total + repository.outgoing,
        0,
      ),
    }),
    [repositories],
  );

  const filteredFiles = files.filter((path) =>
    path.toLowerCase().includes(contextSearch.toLowerCase()),
  );

  const workspaceStyle = {
    "--repo-panel-width": `${repoWidth}px`,
    "--context-panel-width": `${contextWidth}px`,
  } as CSSProperties;

  return (
    <main className="repository-workspace" style={workspaceStyle}>
      <section className="workspace-overview">
        <button
          className="icon-button mobile-menu-button"
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open repositories"
        >
          <Menu size={18} />
        </button>
        <div className="overview-title">
          <span className="eyebrow">Local Git workspace</span>
          <strong>{data?.workspaceName || "Workspace"}</strong>
          <span>
            {loading ? "Scanning repositories…" : `Updated ${relativeTime(data?.generatedAt)}`}
          </span>
        </div>
        <div className="overview-stats">
          <div>
            <strong>{stats.total}</strong>
            <span>Repositories</span>
          </div>
          <div className={stats.changed ? "has-signal" : ""}>
            <strong>{stats.changed}</strong>
            <span>Changed</span>
          </div>
          <div className={stats.conflicts ? "has-danger" : ""}>
            <strong>{stats.conflicts}</strong>
            <span>Conflicts</span>
          </div>
          <div className={stats.incoming ? "has-incoming" : ""}>
            <strong>{stats.incoming}</strong>
            <span>Incoming</span>
          </div>
          <div className={stats.outgoing ? "has-outgoing" : ""}>
            <strong>{stats.outgoing}</strong>
            <span>Outgoing</span>
          </div>
        </div>
        <div className="overview-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "is-spinning" : ""} size={14} />
            Refresh
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void fetchEveryRepository()}
            disabled={Boolean(fetching)}
          >
            <CloudDownload className={fetching === "all" ? "is-spinning" : ""} size={15} />
            {fetching === "all" ? "Fetching…" : "Fetch all"}
          </button>
        </div>
      </section>

      {(error || toast) && (
        <div className={`workspace-toast ${error ? "is-error" : ""}`}>
          {error ? <AlertTriangle size={15} /> : <Check size={15} />}
          <span>{error || toast}</span>
          {toast && (
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <section className="workspace-panels" onPointerDown={rememberResizeStart}>
        <RepositoryNavigator
          repositories={repositories}
          selectedId={selectedId}
          onSelect={selectRepository}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          searchInputRef={searchInputRef}
        />
        <ResizeHandle side="repository" onResize={resizeRepo} />

        <aside className="context-panel">
          {selectedRepository ? (
            <>
              <div className="repository-header">
                <div className="repository-header__top">
                  <span className="repo-avatar">
                    {selectedRepository.id
                      .split("-")
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase())
                      .join("") || "R"}
                  </span>
                  <div>
                    <h2>{selectedRepository.id}</h2>
                    <span>
                      <GitBranch size={12} />
                      {selectedRepository.detached
                        ? "Detached HEAD"
                        : selectedRepository.branch ||
                          (selectedRepository.unborn ? "No commits yet" : "Unknown branch")}
                    </span>
                  </div>
                  <div className="repository-header__actions">
                    <button
                      className="icon-button"
                      type="button"
                      title="New terminal in this repository"
                      aria-label="New terminal in this repository"
                      onClick={() =>
                        void startRepositoryTerminal(selectedRepository.id, "shell")
                      }
                    >
                      <SquareTerminal size={16} />
                    </button>
                    <button
                      ref={runMenuButtonRef}
                      className={`icon-button ${runMenuOpen ? "is-active" : ""}`}
                      type="button"
                      title="Run a package script"
                      aria-label="Run a package script"
                      aria-haspopup="menu"
                      aria-expanded={runMenuOpen}
                      aria-controls="repository-run-menu"
                      onClick={() => void openRunMenu(selectedRepository.id)}
                    >
                      <Play size={15} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Fetch this repository"
                      aria-label="Fetch this repository"
                      disabled={Boolean(fetching)}
                      onClick={() => void fetchRepository(selectedRepository.id)}
                    >
                      <CloudDownload
                        className={
                          fetching === selectedRepository.id ? "is-spinning" : ""
                        }
                        size={16}
                      />
                    </button>
                  </div>
                </div>
                <div className="repository-header__meta">
                  {selectedRepository.upstream ? (
                    <>
                      <span>
                        <ArrowDown size={11} /> {selectedRepository.incoming} incoming
                      </span>
                      <span>
                        <ArrowUp size={11} /> {selectedRepository.outgoing} outgoing
                      </span>
                    </>
                  ) : (
                    <span className="no-upstream">No upstream configured</span>
                  )}
                  <span title={exactDate(selectedRepository.fetchedAt)}>
                    <Clock3 size={11} />
                    {selectedRepository.fetchedAt
                      ? `Fetched ${relativeTime(selectedRepository.fetchedAt)}`
                      : "Not fetched this session"}
                  </span>
                </div>
                {terminalError && (
                  <div className="repository-run-error">{terminalError}</div>
                )}
                {runMenuOpen && (
                  <div
                    ref={runMenuRef}
                    className="repository-run-menu"
                    id="repository-run-menu"
                    role="menu"
                    aria-label="Package scripts"
                  >
                    <span>Package scripts</span>
                    {scriptsLoading ? (
                      <p>Loading package scripts…</p>
                    ) : repositoryScripts.length ? (
                      repositoryScripts.map((script) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={script.name}
                          onClick={() =>
                            void startRepositoryTerminal(
                              selectedRepository.id,
                              "script",
                              script.name,
                            )
                          }
                        >
                          <Play size={12} />
                          <strong>{script.name}</strong>
                          <small>{script.runner}</small>
                        </button>
                      ))
                    ) : (
                      <p>No package.json scripts found.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="context-tabs" role="tablist">
                {(
                  [
                    ["changes", GitCompareArrows, selectedRepository.summary.files],
                    ["commits", GitCommitHorizontal, null],
                    ["files", Files, null],
                  ] as const
                ).map(([value, Icon, count]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    className={tab === value ? "is-active" : ""}
                    key={value}
                    onClick={() => selectTab(value)}
                  >
                    <Icon size={14} />
                    {value[0].toUpperCase() + value.slice(1)}
                    {count !== null && <span>{count}</span>}
                  </button>
                ))}
              </div>
              {tab !== "commits" && (
                <label className="context-search">
                  <Search size={13} />
                  <input
                    value={contextSearch}
                    onChange={(event) => setContextSearch(event.target.value)}
                    placeholder={tab === "changes" ? "Filter changed files" : "Filter files"}
                    aria-label={tab === "changes" ? "Filter changed files" : "Filter files"}
                  />
                </label>
              )}
              {tab === "commits" && (
                <div className="commit-scope">
                  {(["local", "incoming", "outgoing"] as CommitScope[]).map((scope) => (
                    <button
                      type="button"
                      className={commitScope === scope ? "is-active" : ""}
                      key={scope}
                      onClick={() => {
                        setCommitScope(scope);
                        setSelectedCommit(null);
                        setCompareRequest(null);
                      }}
                    >
                      {scope === "local" ? "Latest" : scope}
                      {scope === "incoming" && selectedRepository.incoming > 0 && (
                        <span>{selectedRepository.incoming}</span>
                      )}
                      {scope === "outgoing" && selectedRepository.outgoing > 0 && (
                        <span>{selectedRepository.outgoing}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="context-content">
                {contextLoading ? (
                  <div className="panel-skeleton" aria-label="Loading">
                    {Array.from({ length: 7 }, (_, index) => (
                      <span key={index} />
                    ))}
                  </div>
                ) : contextError ? (
                  <div className="panel-empty panel-empty--large is-error">
                    <AlertTriangle size={23} />
                    <strong>Could not load this view</strong>
                    <span>{contextError}</span>
                  </div>
                ) : tab === "changes" ? (
                  <ChangeList
                    changes={changes}
                    selected={compareRequest}
                    search={contextSearch}
                    onSelect={(change) =>
                      setCompareRequest({
                        path: change.path,
                        previousPath: change.previousPath,
                        scope: change.scope,
                      })
                    }
                  />
                ) : tab === "commits" ? (
                  <CommitList
                    commits={commits}
                    selectedSha={selectedCommit}
                    onSelect={(commit) => {
                      setSelectedCommit(commit.sha);
                      setCompareRequest(null);
                    }}
                  />
                ) : filteredFiles.length ? (
                  <FileTree
                    paths={filteredFiles}
                    selectedPath={compareRequest?.path ?? null}
                    onSelect={(path) =>
                      setCompareRequest({ path, scope: "working" })
                    }
                  />
                ) : (
                  <div className="panel-empty panel-empty--large">
                    <FileQuestion size={24} />
                    <strong>No files found</strong>
                    <span>Try another file name.</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="panel-empty panel-empty--large">
              <Code2 size={25} />
              <strong>Select a repository</strong>
              <span>Choose one from the workspace list.</span>
            </div>
          )}
        </aside>

        <ResizeHandle side="context" onResize={resizeContext} />

        <section
          className={`viewer-panel ${
            (comparison && compareRequest) || (tab === "commits" && commitDetail)
              ? "has-content"
              : ""
          }`}
        >
          {viewerError ? (
            <div className="viewer-empty">
              <AlertTriangle size={28} />
              <h3>Could not open this comparison</h3>
              <p>{viewerError}</p>
            </div>
          ) : viewerLoading ? (
            <div className="viewer-loading">
              <div className="viewer-loading__head" />
              <div className="viewer-loading__body">
                <span />
                <span />
              </div>
            </div>
          ) : comparison && compareRequest ? (
            <>
              <div className="viewer-titlebar">
                <button
                  className="icon-button viewer-back-button mobile-only"
                  type="button"
                  aria-label="Back to file list"
                  onClick={() => setCompareRequest(null)}
                >
                  <ChevronRight size={16} />
                </button>
                <span
                  className={`viewer-file-icon viewer-file-icon--${
                    comparison.original.binary || comparison.modified.binary
                      ? "binary"
                      : "code"
                  }`}
                >
                  {comparison.original.binary || comparison.modified.binary ? (
                    <Binary size={16} />
                  ) : (
                    <FileCode2 size={16} />
                  )}
                </span>
                <div>
                  <strong>{pathName(comparison.path)}</strong>
                  <span>{pathDirectory(comparison.path) || selectedRepository?.id}</span>
                </div>
                {comparison.previousPath && (
                  <span className="rename-label">
                    {comparison.previousPath} <span>→</span> {comparison.path}
                  </span>
                )}
              </div>
              <Suspense
                fallback={
                  <div className="viewer-empty">
                    <RefreshCw className="is-spinning" size={22} />
                    <h3>Preparing the diff viewer</h3>
                  </div>
                }
              >
                <MonacoDiff comparison={comparison} />
              </Suspense>
            </>
          ) : tab === "commits" && commitDetail ? (
            <div className="commit-detail">
              <div className="commit-detail__hero">
                <button
                  className="icon-button viewer-back-button mobile-only"
                  type="button"
                  aria-label="Back to commits"
                  onClick={() => setSelectedCommit(null)}
                >
                  <ChevronRight size={16} />
                </button>
                <span className="commit-detail__icon">
                  <GitCommitHorizontal size={22} />
                </span>
                <div>
                  <p className="eyebrow">Commit {commitDetail.commit.shortSha}</p>
                  <h2>{commitDetail.commit.subject}</h2>
                  <span>
                    {commitDetail.commit.author} committed{" "}
                    {exactDate(commitDetail.commit.authoredAt)}
                  </span>
                </div>
              </div>
              {commitDetail.commit.body && <p>{commitDetail.commit.body}</p>}
              <div className="commit-files-head">
                <strong>{commitDetail.files.length} changed files</strong>
                <span>Select a file to compare it with its parent.</span>
              </div>
              <div className="commit-files">
                {commitDetail.files.map((file) => (
                  <button
                    type="button"
                    key={`${file.status}:${file.path}`}
                    onClick={() =>
                      setCompareRequest({
                        path: file.path,
                        previousPath: file.previousPath,
                        scope: "commit",
                        commit: commitDetail.commit.sha,
                      })
                    }
                  >
                    <span className={`change-kind change-kind--${file.status}`}>
                      {file.status}
                    </span>
                    <File size={14} />
                    <span>{file.path}</span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="viewer-empty viewer-empty--welcome">
              <span className="empty-orbit">
                <GitCompareArrows size={25} />
              </span>
              <p className="eyebrow">Side-by-side review</p>
              <h2>
                {selectedRepository?.summary.files
                  ? "Choose a file to inspect its changes."
                  : "Everything is in view."}
              </h2>
              <p>
                {selectedRepository?.summary.files
                  ? "The original appears on the left and your local version on the right."
                  : "Select a commit or file to explore this repository."}
              </p>
              <div className="privacy-card">
                <CircleDot size={14} />
                File contents stay on this machine
              </div>
            </div>
          )}
        </section>
      </section>
      {mobileOpen && (
        <button
          className="mobile-scrim"
          type="button"
          aria-label="Close repositories"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </main>
  );
}
