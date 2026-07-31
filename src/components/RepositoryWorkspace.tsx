import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Binary,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  Code2,
  File,
  FileCode2,
  FileQuestion,
  GitCommitHorizontal,
  GitBranch,
  GitCompareArrows,
  History,
  Menu,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  SquareTerminal,
  Play,
  Trash2,
  Undo2,
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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { routeParams, updateRoute } from "../route";
import type {
  AiProvider,
  AiTerminalAction,
  ChangeAction,
  ChangeActionScope,
  ChangeItem,
  ChangeSelection,
  ChangeScope,
  AiStatus,
  Commit,
  CommitContext,
  CommitScope,
  Comparison,
  FileChange,
  RepositoriesResponse,
  RepositoryBranch,
  RepositoryBranches,
  RepositorySummary,
  RepositoryTab,
  RepositoryScript,
  SyncResult,
  SyncStrategy,
  StashDetails,
  StashSummary,
  TerminalKind,
  TerminalSession,
  Theme,
  ResolvedColorScheme,
  WorkspaceFile,
} from "../types";
import { AiTerminalModal } from "./AiTerminalModal";
import { CommitModal } from "./CommitModal";
import { FileTree } from "./FileTree";
import { RepositoryMark } from "./RepositoryMark";
import { StashModal } from "./StashModal";
import { SyncRecoveryModal } from "./SyncRecoveryModal";
import { repositoryHealth } from "../repository-mark";

const MonacoDiff = lazy(() => import("./MonacoDiff"));
const TOAST_DURATION_MS = 4_000;

type RepoFilter =
  | "all"
  | "changed"
  | "incoming"
  | "outgoing"
  | "errors";
type WorkingChangeScope = Exclude<ChangeScope, "commit" | "stash">;
type ChangeGroupKey = "conflict" | "staged" | "unstaged";

interface CompareRequest {
  path: string;
  previousPath?: string | null;
  scope: ChangeScope;
  commit?: string | null;
  stash?: string | null;
}

interface WorkspaceToast {
  message: string;
  tone: "success" | "error";
  durationMs: number;
  action?: {
    label: string;
    run: () => void;
  };
}

function getParams() {
  return routeParams();
}

function readableError(caught: unknown, fallback: string) {
  if (!(caught instanceof Error)) return fallback;
  return caught.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^(?:(?:[A-Za-z_$][\w$]*)?Error):\s*/i, "");
}

function readableSyncError(caught: unknown) {
  const detail = readableError(caught, "Sync failed. Try again.");

  if (/local changes .*overwritten by merge/i.test(detail)) {
    return "Sync stopped to protect your local changes. Commit, revert, or stash the affected files, then try Sync again.";
  }

  if (/untracked working tree files .*overwritten by merge/i.test(detail)) {
    return "Sync stopped because incoming files would overwrite untracked files. Commit, move, or remove those files, then try Sync again.";
  }

  if (/not possible to fast-forward/i.test(detail)) {
    return "Sync needs a linear history, but the local and remote commits have diverged. Rebase or merge them in a terminal, then try Sync again.";
  }

  return detail.replace(/^error:\s*/i, "");
}

function changeActionKey(
  action: ChangeAction,
  selection: ChangeSelection,
) {
  const target = selection.paths?.join("\0") ?? selection.path ?? "*";
  return `${action}:${selection.scope}:${target}`;
}

function initialTab(): RepositoryTab {
  const value = getParams().get("tab");
  return value === "commits" || value === "files" || value === "stashes"
    ? value
    : "changes";
}

function initialCompare(): CompareRequest | null {
  const path = getParams().get("file");
  if (!path) return null;
  const scope = getParams().get("scope") as ChangeScope | null;
  return {
    path,
    scope:
      scope &&
      ["staged", "working", "untracked", "conflict", "commit", "stash"].includes(
        scope,
      )
        ? scope
        : "working",
    commit: getParams().get("commit"),
    stash: getParams().get("stash"),
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

function repositoryGroupId(repository: RepositorySummary) {
  return repository.groupId || `repository:${repository.id}`;
}

function repositoryGroupName(repository: RepositorySummary) {
  return repository.groupName || repository.id;
}

function repositoryDisplayName(repository: RepositorySummary) {
  return repository.displayName?.trim() || repository.id;
}

const scopeGroups: Array<{
  key: ChangeGroupKey;
  scopes: WorkingChangeScope[];
  actionScope: ChangeActionScope;
  label: string;
  description?: string;
}> = [
  {
    key: "conflict",
    scopes: ["conflict"],
    actionScope: "conflict",
    label: "Conflicts",
    description: "Needs attention",
  },
  {
    key: "staged",
    scopes: ["staged"],
    actionScope: "staged",
    label: "Staged",
  },
  {
    key: "unstaged",
    scopes: ["working", "untracked"],
    actionScope: "unstaged",
    label: "Unstaged",
  },
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
  tone: "neutral" | "dirty" | "incoming" | "outgoing" | "danger" | "paused";
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={`status-badge status-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

function PausedSyncBanner({
  repository,
  providerLabel,
  aiReady,
  busy,
  onShowRecovery,
  onOpenTerminal,
  onStartAi,
}: {
  repository: RepositorySummary;
  providerLabel: string;
  aiReady: boolean;
  busy: boolean;
  onShowRecovery: () => void;
  onOpenTerminal: () => void;
  onStartAi: () => void;
}) {
  const operation = repository.operation;
  if (!operation) return null;
  const operationLabel = operation === "rebase" ? "Rebase" : "Merge";
  const conflicts = repository.summary.conflicts;

  return (
    <section
      className="paused-sync-banner"
      aria-label={`${operationLabel} recovery`}
    >
      <div className="paused-sync-banner__status">
        <span>
          <GitCompareArrows size={15} />
        </span>
        <div>
          <strong>{operationLabel} paused</strong>
          <small>
            {conflicts
              ? `${conflicts} conflicted ${
                  conflicts === 1 ? "file needs" : "files need"
                } resolution`
              : "All conflicts are staged and Git is ready to continue"}
          </small>
        </div>
      </div>
      <p>
        {conflicts
          ? "Edit the conflicted files first, then mark each one resolved."
          : `Continue or abort the ${operation} from a repository terminal.`}
      </p>
      <div className="paused-sync-banner__actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={onShowRecovery}
        >
          Recovery details
        </button>
        {conflicts > 0 && (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={onStartAi}
          >
            <Sparkles size={13} />
            {aiReady ? `Resolve with ${providerLabel}` : "AI assistance"}
          </button>
        )}
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={onOpenTerminal}
        >
          <SquareTerminal size={13} />
          {conflicts ? "Open terminal" : "Continue in terminal"}
        </button>
      </div>
    </section>
  );
}

function RepositoryNavigator({
  repositories,
  rootKind,
  loading,
  selectedId,
  onSelect,
  mobileOpen,
  onCloseMobile,
  searchInputRef,
  onToggleFavourite,
  onToggleArchived,
  onRenameRepository,
  onOpenBranches,
}: {
  repositories: RepositorySummary[];
  rootKind: RepositoriesResponse["rootKind"];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleFavourite: (groupId: string, favourite: boolean) => void;
  onToggleArchived: (repositoryId: string, archived: boolean) => void;
  onRenameRepository: (repositoryId: string, name: string) => Promise<boolean>;
  onOpenBranches: (repositoryId: string, anchor: HTMLElement) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RepoFilter>("all");
  const [archivedExpanded, setArchivedExpanded] = useState(
    () =>
      window.localStorage.getItem("local-status:archived-repositories-open") ===
      "true",
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(
          window.localStorage.getItem("local-status:expanded-repository-groups") ||
            "[]",
        ) as string[],
      );
    } catch {
      return new Set();
    }
  });
  const [editingRepositoryId, setEditingRepositoryId] = useState<string | null>(
    null,
  );
  const [repositoryNameDraft, setRepositoryNameDraft] = useState("");
  const [repositoryNameBusy, setRepositoryNameBusy] = useState(false);
  const repositoryNameInputRef = useRef<HTMLInputElement>(null);
  const [repositoryMenu, setRepositoryMenu] = useState<{
    repositoryId: string;
    top: number;
    left: number;
  } | null>(null);
  const repositoryMenuRef = useRef<HTMLDivElement>(null);
  const { groups, archivedGroups } = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    function groupedRepositories(entries: RepositorySummary[]) {
      const grouped = new Map<string, RepositorySummary[]>();
      for (const repository of entries) {
        const groupId = repositoryGroupId(repository);
        grouped.set(groupId, [...(grouped.get(groupId) ?? []), repository]);
      }
      return [...grouped.entries()]
        .map(([id, members]) => {
          const sortedMembers = [...members].sort(
            (left, right) =>
              Number(right.isPrimaryWorktree) - Number(left.isPrimaryWorktree) ||
              repositoryDisplayName(left).localeCompare(
                repositoryDisplayName(right),
              ),
          );
          return {
            id,
            name: repositoryGroupName(members[0]),
            isWorkspaceRoot: members.some(
              (member) => member.isWorkspaceRoot,
            ),
            favourite: members.some((member) => member.favourite),
            archived: members.every((member) => member.archived),
            members: sortedMembers,
            files: members.reduce(
              (total, member) => total + member.summary.files,
              0,
            ),
            incoming: members.reduce(
              (total, member) => total + member.incoming,
              0,
            ),
            outgoing: members.reduce(
              (total, member) => total + member.outgoing,
              0,
            ),
            paused: members.filter((member) => member.operation).length,
          };
        })
        .filter(
          (group) =>
            !normalizedQuery ||
            group.name.toLowerCase().includes(normalizedQuery) ||
            group.members.some(
              (repository) =>
                repositoryDisplayName(repository)
                  .toLowerCase()
                  .includes(normalizedQuery) ||
                repository.id.toLowerCase().includes(normalizedQuery) ||
                repository.branch?.toLowerCase().includes(normalizedQuery),
            ),
        )
        .sort(
          (left, right) =>
            Number(right.isWorkspaceRoot) - Number(left.isWorkspaceRoot) ||
            Number(right.favourite) - Number(left.favourite) ||
            left.name.localeCompare(right.name),
        );
    }
    const activeGroups = groupedRepositories(
      repositories.filter((repository) => !repository.archived),
    );
    return {
      groups: activeGroups.filter((group) =>
        group.members.some((repository) =>
          repositoryPassesFilter(repository, filter),
        ),
      ),
      archivedGroups: groupedRepositories(
        repositories.filter((repository) => repository.archived),
      ),
    };
  }, [filter, query, repositories]);
  const selectedGroupId = repositories.find(
    (repository) => repository.id === selectedId,
  );
  const selectedRepositoryGroupId = selectedGroupId
    ? repositoryGroupId(selectedGroupId)
    : null;

  useEffect(() => {
    if (!selectedRepositoryGroupId) return;
    setExpandedGroups((current) => {
      if (current.has(selectedRepositoryGroupId)) return current;
      const next = new Set(current).add(selectedRepositoryGroupId);
      window.localStorage.setItem(
        "local-status:expanded-repository-groups",
        JSON.stringify([...next]),
      );
      return next;
    });
  }, [selectedRepositoryGroupId]);

  useEffect(() => {
    if (!editingRepositoryId) return;
    window.requestAnimationFrame(() => {
      repositoryNameInputRef.current?.focus();
      repositoryNameInputRef.current?.select();
    });
  }, [editingRepositoryId]);

  useEffect(() => {
    if (!repositoryMenu) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        !repositoryMenuRef.current?.contains(target)
      ) {
        setRepositoryMenu(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setRepositoryMenu(null);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [repositoryMenu]);

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      window.localStorage.setItem(
        "local-status:expanded-repository-groups",
        JSON.stringify([...next]),
      );
      return next;
    });
  }

  function openRepositoryMenu(
    repository: RepositorySummary,
    anchor: HTMLButtonElement,
  ) {
    const bounds = anchor.getBoundingClientRect();
    const width = 176;
    setRepositoryMenu({
      repositoryId: repository.id,
      top: Math.min(bounds.bottom + 5, window.innerHeight - 104),
      left: Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8)),
    });
  }

  function beginRepositoryRename(repository: RepositorySummary) {
    setRepositoryMenu(null);
    setEditingRepositoryId(repository.id);
    setRepositoryNameDraft(repositoryDisplayName(repository));
  }

  function cancelRepositoryRename() {
    if (repositoryNameBusy) return;
    setEditingRepositoryId(null);
    setRepositoryNameDraft("");
  }

  async function saveRepositoryName(repository: RepositorySummary) {
    const name = repositoryNameDraft.trim();
    const currentName = repositoryDisplayName(repository);
    if (!name || name === currentName) {
      if (name === currentName) cancelRepositoryRename();
      return;
    }
    setRepositoryNameBusy(true);
    try {
      if (await onRenameRepository(repository.id, name)) {
        setEditingRepositoryId(null);
        setRepositoryNameDraft("");
      }
    } finally {
      setRepositoryNameBusy(false);
    }
  }

  function favouriteAction(groupId: string, name: string, favourite: boolean) {
    return (
      <button
        className={`repository-favourite ${favourite ? "is-active" : ""}`}
        type="button"
        aria-label={
          favourite
            ? `Remove ${name} from favourites`
            : `Add ${name} to favourites`
        }
        data-tooltip={favourite ? "Remove from favourites" : "Add to favourites"}
        onClick={() => onToggleFavourite(groupId, !favourite)}
      >
        <Star size={14} fill="currentColor" />
      </button>
    );
  }

  function repositoryRow(
    repository: RepositorySummary,
    favouriteControl?: { groupId: string; favourite: boolean },
  ) {
    const selected = repository.id === selectedId;
    const displayName = repositoryDisplayName(repository);
    const renaming = editingRepositoryId === repository.id;
    return (
      <div
        className={`repository-row repository-row--${repositoryHealth(repository)} ${
          selected ? "is-selected" : ""
        } ${
          repositoryMenu?.repositoryId === repository.id
            ? "is-context-menu-open"
            : ""
        }`}
        key={repository.id}
        role="listitem"
      >
        {renaming ? (
          <form
            className="repository-row__rename"
            onSubmit={(event) => {
              event.preventDefault();
              void saveRepositoryName(repository);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              cancelRepositoryRename();
            }}
          >
            <RepositoryMark repository={repository} />
            <input
              ref={repositoryNameInputRef}
              value={repositoryNameDraft}
              maxLength={80}
              aria-label={`New name for ${displayName}`}
              disabled={repositoryNameBusy}
              onChange={(event) => setRepositoryNameDraft(event.target.value)}
            />
            <button
              type="submit"
              aria-label="Save worktree name"
              disabled={
                repositoryNameBusy ||
                !repositoryNameDraft.trim() ||
                repositoryNameDraft.trim() === displayName
              }
            >
              {repositoryNameBusy ? (
                <RefreshCw className="is-spinning" size={13} />
              ) : (
                <Check size={14} />
              )}
            </button>
            <button
              type="button"
              aria-label="Cancel worktree rename"
              disabled={repositoryNameBusy}
              onClick={cancelRepositoryRename}
            >
              <X size={14} />
            </button>
          </form>
        ) : (
          <button
            className="repository-row__select"
            type="button"
            aria-current={selected ? "true" : undefined}
            aria-disabled={repository.archived}
            disabled={repository.archived}
            onClick={() => {
              onSelect(repository.id);
              onCloseMobile();
            }}
          >
            <RepositoryMark repository={repository} />
            <span className="repository-row__content">
              <span className="repository-row__title">
                <span className="repository-row__name">{displayName}</span>
                {repository.isWorkspaceRoot && (
                  <span
                    className="repository-root-badge"
                    title="Selected folder"
                  >
                    Root
                  </span>
                )}
              </span>
            </span>
          </button>
        )}
        <button
          className="repository-row__branch"
          type="button"
          aria-label={
            repository.operation
              ? `${repository.operation === "rebase" ? "Rebase" : "Merge"} paused for ${displayName}`
              : `Switch branch for ${displayName}`
          }
          data-tooltip={
            repository.operation
              ? "Finish or abort the paused operation before switching branches"
              : "Switch branch"
          }
          disabled={repository.archived || Boolean(repository.operation)}
          onClick={(event) => onOpenBranches(repository.id, event.currentTarget)}
        >
          <GitBranch size={11} />
          <span>
            {repository.operation
              ? `${repository.operation === "rebase" ? "Rebase" : "Merge"} paused`
              : repository.detached
              ? "Detached HEAD"
              : repository.branch ||
                (repository.unborn ? "No commits yet" : "Unknown")}
          </span>
        </button>
        <span className="repository-row__signals">
          {repository.operation && (
            <StatusBadge
              tone="paused"
              title={`${repository.operation === "rebase" ? "Rebase" : "Merge"} paused`}
            >
              <GitCompareArrows size={10} />
            </StatusBadge>
          )}
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
        <span className="repository-row__actions">
          {favouriteControl && !repository.archived
            ? favouriteAction(
                favouriteControl.groupId,
                repositoryGroupName(repository),
                favouriteControl.favourite,
              )
            : null}
          {!renaming && (
            <button
              className="repository-overflow-action"
              type="button"
              aria-label={`More actions for ${displayName}`}
              aria-haspopup="menu"
              aria-expanded={repositoryMenu?.repositoryId === repository.id}
              onClick={(event) =>
                openRepositoryMenu(repository, event.currentTarget)
              }
            >
              <MoreHorizontal size={16} />
            </button>
          )}
        </span>
      </div>
    );
  }

  function repositoryGroup(group: (typeof groups)[number]) {
    if (group.members.length === 1) {
      return repositoryRow(group.members[0], {
        groupId: group.id,
        favourite: group.favourite,
      });
    }

    return (
      <section className="repository-group" key={group.id} role="listitem">
        <div className="repository-group__header">
          <button
            type="button"
            aria-expanded={expandedGroups.has(group.id)}
            onClick={() => toggleGroup(group.id)}
          >
            <ChevronRight
              className={expandedGroups.has(group.id) ? "is-open" : ""}
              size={14}
            />
            <span>
              <span className="repository-group__title">
                <strong>{group.name}</strong>
                {group.isWorkspaceRoot && (
                  <span
                    className="repository-root-badge"
                    title="Selected folder"
                  >
                    Root
                  </span>
                )}
              </span>
              <small>{group.members.length} checkouts</small>
            </span>
          </button>
          <span className="repository-row__signals">
            {group.paused > 0 && (
              <StatusBadge
                tone="paused"
                title={`${group.paused} paused Git ${
                  group.paused === 1 ? "operation" : "operations"
                }`}
              >
                <GitCompareArrows size={10} />
                {group.paused}
              </StatusBadge>
            )}
            {group.files > 0 && (
              <StatusBadge tone="dirty">{group.files}</StatusBadge>
            )}
            {group.incoming > 0 && (
              <StatusBadge tone="incoming">{group.incoming}</StatusBadge>
            )}
            {group.outgoing > 0 && (
              <StatusBadge tone="outgoing">{group.outgoing}</StatusBadge>
            )}
          </span>
          <span className="repository-row__actions">
            {!group.archived
              ? favouriteAction(group.id, group.name, group.favourite)
              : null}
          </span>
        </div>
        {expandedGroups.has(group.id) && (
          <div
            className="repository-group__members"
            role="list"
            aria-label={`${group.name} checkouts`}
          >
            {group.members.map((repository) => repositoryRow(repository))}
          </div>
        )}
      </section>
    );
  }

  const showsArchivedGroups = filter === "all" && archivedGroups.length > 0;
  const menuRepository = repositoryMenu
    ? repositories.find(
        (repository) => repository.id === repositoryMenu.repositoryId,
      ) ?? null
    : null;

  return (
    <>
      <aside className={`repo-panel ${mobileOpen ? "is-mobile-open" : ""}`}>
      <div className="panel-titlebar">
        <div>
          <span className="panel-kicker">
            {rootKind === "hybrid" ? "Repository workspace" : "Workspace"}
          </span>
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
      </label>
      <div className="filter-strip" aria-label="Filter repositories">
        {(
          ["all", "changed", "incoming", "outgoing"] as RepoFilter[]
        ).map((value) => (
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
      <div className="repository-list" role="list" aria-label="Repositories">
        {groups.map(repositoryGroup)}
        {!groups.length && !showsArchivedGroups && loading ? (
          <div
            className="panel-empty panel-empty--repositories panel-empty--loading"
            role="status"
            aria-live="polite"
          >
            <RefreshCw className="is-spinning" size={22} />
            <strong>Loading repositories</strong>
            <span>Scanning your workspace…</span>
          </div>
        ) : !groups.length && !showsArchivedGroups ? (
          <div className="panel-empty panel-empty--repositories">
            <Search size={22} />
            <strong>No repositories found</strong>
            <span>
              {repositories.length === 0
                ? "Choose a Git repository or a folder containing repositories."
                : "Try another name or filter."}
            </span>
          </div>
        ) : null}
        {showsArchivedGroups && (
          <section className="archived-repositories" role="listitem">
            <button
              className="archived-repositories__toggle"
              type="button"
              aria-expanded={archivedExpanded}
              onClick={() => {
                const next = !archivedExpanded;
                setArchivedExpanded(next);
                window.localStorage.setItem(
                  "local-status:archived-repositories-open",
                  String(next),
                );
              }}
            >
              <Archive size={13} />
              <span>Archived</span>
              <small>
                {
                  repositories.filter((repository) => repository.archived)
                    .length
                }
              </small>
              <ChevronRight
                className={archivedExpanded ? "is-open" : ""}
                size={14}
              />
            </button>
            {archivedExpanded && (
              <div
                className="archived-repositories__list"
                role="list"
                aria-label="Archived repositories"
              >
                {archivedGroups.map(repositoryGroup)}
              </div>
            )}
          </section>
        )}
      </div>
      <div className="panel-foot">
        <span className="privacy-dot" />
        Local Git data only
      </div>
      </aside>
      {repositoryMenu &&
        menuRepository &&
        createPortal(
          <div
            ref={repositoryMenuRef}
            className="repository-context-menu"
            role="menu"
            aria-label={`Actions for ${repositoryDisplayName(menuRepository)}`}
            style={{
              top: repositoryMenu.top,
              left: repositoryMenu.left,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => beginRepositoryRename(menuRepository)}
            >
              <Pencil size={14} />
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRepositoryMenu(null);
                onToggleArchived(menuRepository.id, !menuRepository.archived);
              }}
            >
              {menuRepository.archived ? (
                <ArchiveRestore size={14} />
              ) : (
                <Archive size={14} />
              )}
              {menuRepository.archived ? "Restore" : "Archive"}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

function ChangeList({
  changes,
  selected,
  search,
  busy,
  disabled,
  onSelect,
  onAction,
  onStash,
}: {
  changes: ChangeItem[];
  selected: CompareRequest | null;
  search: string;
  busy: string | null;
  disabled: boolean;
  onSelect: (change: ChangeItem) => void;
  onAction: (action: ChangeAction, selection: ChangeSelection) => void;
  onStash: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<ChangeGroupKey>>(
    () => new Set(),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const selectionAnchor = useRef<{
    group: ChangeGroupKey;
    id: string;
  } | null>(null);
  const shiftPressed = useRef(false);
  const additiveSelectionPressed = useRef(false);
  const filtered = changes.filter((change) =>
    change.path.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Shift") shiftPressed.current = true;
      if (event.key === "Meta" || event.key === "Control") {
        additiveSelectionPressed.current = true;
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === "Shift") shiftPressed.current = false;
      if (event.key === "Meta" || event.key === "Control") {
        additiveSelectionPressed.current = false;
      }
    }

    function handleBlur() {
      shiftPressed.current = false;
      additiveSelectionPressed.current = false;
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    const available = new Set(changes.map((change) => change.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
    if (
      selectionAnchor.current &&
      !available.has(selectionAnchor.current.id)
    ) {
      selectionAnchor.current = null;
    }
  }, [changes]);

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

  function actionButton(
    action: ChangeAction,
    selection: ChangeSelection,
  ) {
    const key = changeActionKey(action, selection);
    const verb =
      action === "stage" && selection.scope === "conflict"
        ? "Mark resolved"
        : action === "stage"
          ? "Stage"
          : action === "unstage"
            ? "Unstage"
            : "Revert";
    const label = selection.paths?.length
      ? `${verb} ${selection.paths.length} selected files`
      : selection.path
        ? `${verb} ${selection.path}`
        : `${verb} all ${selection.scope} changes`;
    const Icon = action === "stage" ? Plus : action === "unstage" ? Minus : Undo2;
    return (
      <button
        type="button"
        className={`change-action ${action === "revert" ? "is-destructive" : ""}`}
        title={label}
        aria-label={label}
        disabled={Boolean(busy) || disabled}
        onClick={() => onAction(action, selection)}
      >
        {busy === key ? <RefreshCw className="is-spinning" size={12} /> : <Icon size={13} />}
      </button>
    );
  }

  function stashButton(path: string) {
    const label = `Stash all changes for ${path}`;
    return (
      <button
        type="button"
        className="change-action"
        title={label}
        aria-label={label}
        disabled={Boolean(busy) || disabled}
        onClick={() => onStash(path)}
      >
        <Archive size={12} />
      </button>
    );
  }

  function selectionForRow(
    group: (typeof scopeGroups)[number],
    items: ChangeItem[],
    change: ChangeItem,
  ): ChangeSelection {
    if (!selectedIds.has(change.id)) {
      return { scope: change.scope as ChangeActionScope, path: change.path };
    }
    const selectedItems = items.filter((item) => selectedIds.has(item.id));
    if (selectedItems.length < 2) {
      return { scope: change.scope as ChangeActionScope, path: change.path };
    }
    const scopes = new Set(selectedItems.map((item) => item.scope));
    return {
      scope:
        scopes.size === 1
          ? (selectedItems[0].scope as ChangeActionScope)
          : group.actionScope,
      paths: [...new Set(selectedItems.map((item) => item.path))],
    };
  }

  function actionsFor(
    group: (typeof scopeGroups)[number],
    items: ChangeItem[],
    change: ChangeItem,
  ) {
    const selection = selectionForRow(group, items, change);
    const scope = change.scope as WorkingChangeScope;
    return (
      <span className="change-actions">
        {scope !== "conflict" && stashButton(change.path)}
        {(scope === "working" || scope === "untracked") &&
          actionButton("revert", selection)}
        {scope === "staged"
          ? actionButton("unstage", selection)
          : actionButton("stage", selection)}
      </span>
    );
  }

  function actionsForGroup(group: (typeof scopeGroups)[number]) {
    return (
      <span className="change-actions">
        {group.key === "unstaged" &&
          actionButton("revert", { scope: group.actionScope })}
        {group.key === "staged"
          ? actionButton("unstage", { scope: group.actionScope })
          : actionButton("stage", { scope: group.actionScope })}
      </span>
    );
  }

  function selectChange(
    event: ReactMouseEvent<HTMLButtonElement>,
    group: (typeof scopeGroups)[number],
    items: ChangeItem[],
    change: ChangeItem,
  ) {
    const routeAnchor = items.find(
      (item) =>
        selected?.path === item.path && selected.scope === item.scope,
    );
    const storedAnchor =
      selectionAnchor.current?.group === group.key &&
      items.some((item) => item.id === selectionAnchor.current?.id)
        ? selectionAnchor.current.id
        : undefined;
    const anchorId =
      storedAnchor ?? routeAnchor?.id;
    const extendingRange = event.shiftKey || shiftPressed.current;
    const togglingItem =
      event.metaKey ||
      event.ctrlKey ||
      additiveSelectionPressed.current;
    if (extendingRange && anchorId) {
      const anchorIndex = items.findIndex(
        (item) => item.id === anchorId,
      );
      const clickedIndex = items.findIndex((item) => item.id === change.id);
      if (anchorIndex >= 0 && clickedIndex >= 0) {
        const start = Math.min(anchorIndex, clickedIndex);
        const end = Math.max(anchorIndex, clickedIndex);
        setSelectedIds(
          new Set(items.slice(start, end + 1).map((item) => item.id)),
        );
      } else {
        setSelectedIds(new Set([change.id]));
        selectionAnchor.current = { group: group.key, id: change.id };
      }
    } else if (togglingItem) {
      const itemIds = new Set(items.map((item) => item.id));
      const canExtendCurrentSelection =
        (!selectionAnchor.current ||
          selectionAnchor.current.group === group.key) &&
        [...selectedIds].every((id) => itemIds.has(id));
      const next = canExtendCurrentSelection
        ? new Set(selectedIds)
        : new Set<string>();
      if (!next.size && routeAnchor) next.add(routeAnchor.id);

      if (next.has(change.id) && next.size > 1) {
        next.delete(change.id);
        const nextSelected = items.find((item) => next.has(item.id));
        setSelectedIds(next);
        selectionAnchor.current = nextSelected
          ? { group: group.key, id: nextSelected.id }
          : null;
        if (nextSelected) onSelect(nextSelected);
        return;
      }

      next.add(change.id);
      setSelectedIds(next);
      selectionAnchor.current = { group: group.key, id: change.id };
    } else {
      setSelectedIds(new Set([change.id]));
      selectionAnchor.current = { group: group.key, id: change.id };
    }
    onSelect(change);
  }

  return (
    <div className="change-groups">
      {scopeGroups.map((group) => {
        const items = filtered.filter((change) =>
          group.scopes.includes(change.scope as WorkingChangeScope),
        );
        if (!items.length) return null;
        const isCollapsed = collapsed.has(group.key);
        return (
          <section
            className={`change-group change-group--${group.key}`}
            key={group.key}
          >
            <div className="change-group__header">
              <button
                type="button"
                className="change-group__toggle"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
              >
                <ChevronDown className={isCollapsed ? "is-collapsed" : ""} size={13} />
                <span>{group.label}</span>
                {group.description && <small>{group.description}</small>}
                <strong>{items.length}</strong>
              </button>
              {actionsForGroup(group)}
            </div>
            {!isCollapsed && (
              <div className="change-group__items">
                {items.map((change) => (
                  <div
                  className={`change-row ${
                    selectedIds.has(change.id) ||
                    (selectedIds.size === 0 &&
                      selected?.path === change.path &&
                      selected.scope === change.scope)
                      ? "is-selected"
                      : ""
                  }`}
                  key={change.id}
                >
                    <button
                      type="button"
                      className="change-row__select"
                      aria-pressed={selectedIds.has(change.id)}
                      onClick={(event) =>
                        selectChange(event, group, items, change)
                      }
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
                            : pathDirectory(change.path) || "./"}
                        </small>
                      </span>
                    </button>
                    {actionsFor(group, items, change)}
                  </div>
              ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CommitList({
  commits,
  selectedSha,
  search,
  onSelect,
}: {
  commits: Commit[];
  selectedSha: string | null;
  search: string;
  onSelect: (commit: Commit) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = commits.filter((commit) =>
    [commit.subject, commit.author, commit.shortSha, commit.sha].some((value) =>
      value.toLowerCase().includes(normalizedSearch),
    ),
  );
  if (!filtered.length) {
    return (
      <div className="panel-empty panel-empty--large">
        <History size={24} />
        <strong>{normalizedSearch ? "No matching commits" : "No commits here"}</strong>
        <span>
          {normalizedSearch
            ? "Try another subject, author, or SHA."
            : "This range does not contain any commits."}
        </span>
      </div>
    );
  }
  return (
    <div className="commit-list">
      {filtered.map((commit) => (
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

function BranchPicker({
  repository,
  branches,
  loading,
  busy,
  anchor,
  menuRef,
  onSelect,
}: {
  repository: RepositorySummary;
  branches: RepositoryBranches | null;
  loading: boolean;
  busy: boolean;
  anchor: DOMRect;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (branch: RepositoryBranch) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const groups = [
    {
      label: "Local branches",
      entries: branches?.local ?? [],
    },
    {
      label: "Remote-only branches",
      entries: branches?.remote ?? [],
    },
  ].map((group) => ({
    ...group,
    entries: group.entries.filter((branch) =>
      branch.name.toLowerCase().includes(normalizedQuery),
    ),
  }));
  const width = 310;
  const left = Math.min(
    Math.max(12, anchor.left),
    Math.max(12, window.innerWidth - width - 12),
  );
  const top = Math.max(
    12,
    Math.min(anchor.bottom + 7, window.innerHeight - 420),
  );

  return createPortal(
    <div
      ref={menuRef}
      className="branch-picker"
      role="dialog"
      aria-label={`Switch branch for ${repository.id}`}
      style={{ left, top, width }}
    >
      <div className="branch-picker__header">
        <span>
          <GitBranch size={14} />
          <strong>Switch branch</strong>
        </span>
        <small>{repository.id}</small>
      </div>
      <label className="branch-picker__search">
        <Search size={13} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a branch"
          aria-label="Find a branch"
        />
      </label>
      <div className="branch-picker__list">
        {loading ? (
          <div className="branch-picker__empty">
            <RefreshCw className="is-spinning" size={15} />
            Loading branches…
          </div>
        ) : (
          groups.map((group) =>
            group.entries.length ? (
              <section key={group.label}>
                <span>{group.label}</span>
                {group.entries.map((branch) => (
                  <button
                    type="button"
                    disabled={busy || branch.current}
                    key={branch.ref}
                    onClick={() => onSelect(branch)}
                  >
                    <GitBranch size={13} />
                    <span>{branch.name}</span>
                    {branch.current && <Check size={13} />}
                  </button>
                ))}
              </section>
            ) : null,
          )
        )}
        {!loading && !groups.some((group) => group.entries.length) && (
          <div className="branch-picker__empty">No matching branches.</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function StashList({
  stashes,
  selectedId,
  search,
  onSelect,
}: {
  stashes: StashSummary[];
  selectedId: string | null;
  search: string;
  onSelect: (stash: StashSummary) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = stashes.filter((stash) =>
    [stash.message, stash.branch ?? "", stash.ref, stash.id].some((value) =>
      value.toLowerCase().includes(normalizedSearch),
    ),
  );
  if (!filtered.length) {
    return (
      <div className="panel-empty panel-empty--large">
        <Archive size={24} />
        <strong>{normalizedSearch ? "No matching stashes" : "No saved stashes"}</strong>
        <span>
          {normalizedSearch
            ? "Try another message, branch, or reference."
            : "Stashed work for this repository will appear here."}
        </span>
      </div>
    );
  }
  return (
    <div className="stash-list">
      {filtered.map((stash) => (
        <button
          type="button"
          className={`stash-row ${stash.id === selectedId ? "is-selected" : ""}`}
          key={stash.id}
          onClick={() => onSelect(stash)}
        >
          <span className="stash-row__icon">
            <Archive size={14} />
          </span>
          <span className="stash-row__content">
            <strong>{stash.message}</strong>
            <span>
              {stash.branch || "Detached HEAD"} · {relativeTime(stash.createdAt)}
            </span>
            <code>
              {stash.ref} · {stash.fileCount}{" "}
              {stash.fileCount === 1 ? "file" : "files"}
            </code>
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
  onStartAiTerminal,
  onOpenRecoveryTerminal,
  theme,
  colorScheme,
  findRequest,
  openFileRequest,
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
  onStartAiTerminal: (
    repositoryId: string,
    provider: AiProvider,
    action: AiTerminalAction,
    executablePath: string | null,
  ) => Promise<TerminalSession>;
  onOpenRecoveryTerminal: (
    repositoryId: string,
    command: string,
  ) => Promise<void>;
  theme: Theme;
  colorScheme: ResolvedColorScheme;
  findRequest: number;
  openFileRequest: (WorkspaceFile & { requestId: number }) | null;
}) {
  const [favouriteOverrides, setFavouriteOverrides] = useState<
    Record<string, boolean>
  >(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem(
          "local-status:favourite-repository-groups",
        ) || "{}",
      ) as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [archivedOverrides, setArchivedOverrides] = useState<
    Record<string, boolean>
  >({});
  const [repositoryNameOverrides, setRepositoryNameOverrides] = useState<
    Record<string, string>
  >({});
  const repositories = useMemo(
    () =>
      (data?.repositories ?? []).map((repository) => {
        const groupId = repositoryGroupId(repository);
        return {
          ...repository,
          displayName:
            repositoryNameOverrides[repository.id] ?? repository.displayName,
          archived:
            archivedOverrides[repository.id] ?? repository.archived ?? false,
          favourite:
            favouriteOverrides[groupId] ??
            favouriteOverrides[`repository:${repository.id}`] ??
            repository.favourite ??
            false,
        };
      }),
    [
      archivedOverrides,
      data?.repositories,
      favouriteOverrides,
      repositoryNameOverrides,
    ],
  );
  const activeRepositories = useMemo(
    () => repositories.filter((repository) => !repository.archived),
    [repositories],
  );
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
  const [stashes, setStashes] = useState<StashSummary[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextSearch, setContextSearch] = useState("");
  const [compareRequest, setCompareRequest] = useState<CompareRequest | null>(
    initialCompare,
  );
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [viewerFindRequest, setViewerFindRequest] = useState(0);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(
    () => params.get("commit"),
  );
  const [commitDetail, setCommitDetail] = useState<{
    commit: Commit;
    files: FileChange[];
  } | null>(null);
  const [selectedStash, setSelectedStash] = useState<string | null>(
    () => params.get("stash"),
  );
  const [stashDetail, setStashDetail] = useState<StashDetails | null>(null);
  const [stashModalPath, setStashModalPath] = useState<
    string | null | undefined
  >(undefined);
  const [stashMessage, setStashMessage] = useState("");
  const [stashIncludeUntracked, setStashIncludeUntracked] = useState(true);
  const [stashError, setStashError] = useState<string | null>(null);
  const [stashBusy, setStashBusy] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncRecovery, setSyncRecovery] = useState<
    Extract<SyncResult, { outcome: "diverged" | "paused" }> | null
  >(null);
  const [syncRecoveryAfterStash, setSyncRecoveryAfterStash] = useState<
    Extract<SyncResult, { outcome: "diverged" }> | null
  >(null);
  const [syncStrategy, setSyncStrategy] = useState<SyncStrategy>("rebase");
  const [syncRecoveryError, setSyncRecoveryError] = useState<string | null>(null);
  const [changeBusy, setChangeBusy] = useState<string | null>(null);
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const [branchMenu, setBranchMenu] = useState<{
    repositoryId: string;
    anchor: DOMRect;
  } | null>(null);
  const [branches, setBranches] = useState<RepositoryBranches | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitContext, setCommitContext] = useState<CommitContext | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitPreparing, setCommitPreparing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiRequestId, setAiRequestId] = useState<string | null>(null);
  const [aiTerminal, setAiTerminal] = useState<{
    session: TerminalSession;
    provider: AiProvider;
    action: AiTerminalAction;
  } | null>(null);
  const [toast, setToast] = useState<WorkspaceToast | null>(null);
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
  const contextSearchInputRef = useRef<HTMLInputElement>(null);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const runMenuButtonRef = useRef<HTMLButtonElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const contextRequestKey = useRef<string | null>(null);
  const comparisonRequestKey = useRef<string | null>(null);
  const handledFindRequestRef = useRef(0);

  const selectedRepository =
    activeRepositories.find((repository) => repository.id === selectedId) ?? null;

  function pausedResultFor(
    repository: RepositorySummary,
    repositoryChanges = changes,
  ): Extract<SyncResult, { outcome: "paused" }> | null {
    if (!repository.operation) return null;
    return {
      outcome: "paused",
      repositoryId: repository.id,
      operation: repository.operation,
      branch: repository.branch,
      upstream: repository.upstream,
      conflictFiles: repositoryChanges
        .filter((change) => change.scope === "conflict")
        .map((change) => change.path),
      incoming: repository.incoming,
      outgoing: repository.outgoing,
    };
  }

  function showToast(
    message: string,
    options: {
      tone?: WorkspaceToast["tone"];
      durationMs?: number;
      action?: WorkspaceToast["action"];
    } = {},
  ) {
    setToast({
      message,
      tone: options.tone ?? "success",
      durationMs: options.durationMs ?? TOAST_DURATION_MS,
      action: options.action,
    });
  }

  useEffect(() => {
    if (!activeRepositories.length) {
      setSelectedId(null);
      return;
    }
    if (
      !selectedId ||
      !activeRepositories.some((repository) => repository.id === selectedId)
    ) {
      const firstChanged =
        activeRepositories.find((repository) => repository.summary.files > 0) ??
        activeRepositories[0];
      setSelectedId(firstChanged.id);
    }
  }, [activeRepositories, selectedId]);

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
      updates.commit = compareRequest.commit ?? null;
      updates.stash = compareRequest.stash ?? null;
    } else {
      updates.file = null;
      updates.scope = null;
      updates.commit = tab === "commits" ? selectedCommit : null;
      updates.stash = tab === "stashes" ? selectedStash : null;
    }
    updateRoute(updates);
  }, [compareRequest, selectedCommit, selectedId, selectedStash, tab]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast((current) => (current === toast ? null : current));
    }, toast.durationMs);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!openFileRequest) return;
    setSelectedId(openFileRequest.repositoryId);
    setTab("files");
    setCommitScope("local");
    setSelectedCommit(null);
    setSelectedStash(null);
    setCompareRequest({ path: openFileRequest.path, scope: "working" });
    setContextSearch("");
    setRunMenuOpen(false);
    setMobileOpen(false);
  }, [openFileRequest]);

  useEffect(() => {
    if (!findRequest || handledFindRequestRef.current === findRequest) return;
    handledFindRequestRef.current = findRequest;
    if (aiTerminal || commitModalOpen) return;
    if (compareRequest) {
      setViewerFindRequest(findRequest);
      return;
    }
    contextSearchInputRef.current?.focus();
  }, [
    aiTerminal,
    commitModalOpen,
    compareRequest,
    findRequest,
  ]);

  useEffect(() => {
    setRunMenuOpen(false);
    setTerminalError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedRepository?.operation || aiStatus) return;
    let cancelled = false;
    void api
      .aiStatus()
      .then((status) => {
        if (!cancelled) setAiStatus(status);
      })
      .catch(() => {
        // Recovery remains available through the terminal if provider detection fails.
      });
    return () => {
      cancelled = true;
    };
  }, [aiStatus, selectedRepository?.id, selectedRepository?.operation]);

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
    if (!branchMenu) return;
    function dismissBranchMenu(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !branchMenuRef.current?.contains(target)) {
        setBranchMenu(null);
      }
    }
    function dismissBranchMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setBranchMenu(null);
    }
    document.addEventListener("pointerdown", dismissBranchMenu, true);
    document.addEventListener("keydown", dismissBranchMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismissBranchMenu, true);
      document.removeEventListener("keydown", dismissBranchMenuWithKeyboard);
    };
  }, [branchMenu]);

  useEffect(() => {
    if (!viewerExpanded) return;
    function restoreViewer(event: KeyboardEvent) {
      if (event.key === "Escape") setViewerExpanded(false);
    }
    window.addEventListener("keydown", restoreViewer);
    return () => window.removeEventListener("keydown", restoreViewer);
  }, [viewerExpanded]);

  useEffect(() => {
    if (!compareRequest) setViewerExpanded(false);
  }, [compareRequest]);

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
          : tab === "stashes"
            ? api.stashes(selectedId)
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
        } else if ("stashes" in response) {
          setStashes(response.stashes);
          if (
            !selectedStash ||
            !response.stashes.some((stash) => stash.id === selectedStash)
          ) {
            setSelectedStash(response.stashes[0]?.id ?? null);
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
        if (!cancelled) setContextLoading(false);
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
    if (!selectedId || !selectedStash || tab !== "stashes") {
      setStashDetail(null);
      return;
    }
    let cancelled = false;
    setViewerError(null);
    void api
      .stash(selectedId, selectedStash)
      .then((detail) => {
        if (!cancelled) setStashDetail(detail);
      })
      .catch((caught) => {
        if (!cancelled) {
          setStashDetail(null);
          setViewerError(
            readableError(caught, "Could not load the selected stash."),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedStash, tab, data?.generatedAt]);

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
      compareRequest.stash,
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
    setSelectedStash(null);
    setCompareRequest(null);
    setContextSearch("");
    setRunMenuOpen(false);
    setBranchMenu(null);
    setRepositoryScripts([]);
    setTerminalError(null);
  }, []);

  async function openBranchPicker(repositoryId: string, anchor: HTMLElement) {
    if (branchMenu?.repositoryId === repositoryId) {
      setBranchMenu(null);
      return;
    }
    if (repositoryId !== selectedId) selectRepository(repositoryId);
    setBranchMenu({
      repositoryId,
      anchor: anchor.getBoundingClientRect(),
    });
    setBranches(null);
    setBranchesLoading(true);
    try {
      setBranches(await api.branches(repositoryId));
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : "Could not load branches.",
        { tone: "error" },
      );
      setBranchMenu(null);
    } finally {
      setBranchesLoading(false);
    }
  }

  async function switchBranch(branch: RepositoryBranch) {
    const repositoryId = branchMenu?.repositoryId;
    if (!repositoryId) return;
    setBranchBusy(true);
    setToast(null);
    try {
      const result = await api.switchBranch(repositoryId, branch.ref);
      if (result.cancelled) return;
      setBranchMenu(null);
      setCompareRequest(null);
      setComparison(null);
      setSelectedCommit(null);
      setCommitDetail(null);
      setContextSearch("");
      contextRequestKey.current = null;
      comparisonRequestKey.current = null;
      showToast(
        result.stashed
          ? `Switched to ${branch.name}. Changes are safe in ${result.stashed.ref}.`
          : `Switched to ${branch.name}.`,
      );
      await onRefresh();
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : "Could not switch branches.",
        { tone: "error" },
      );
      await onRefresh();
    } finally {
      setBranchBusy(false);
    }
  }

  async function toggleFavourite(groupId: string, favourite: boolean) {
    const key = `favourite:${groupId}`;
    setChangeBusy(key);
    const previous = favouriteOverrides[groupId];
    const nextOverrides = { ...favouriteOverrides, [groupId]: favourite };
    setFavouriteOverrides(nextOverrides);
    window.localStorage.setItem(
      "local-status:favourite-repository-groups",
      JSON.stringify(nextOverrides),
    );
    try {
      await api.setFavourite(groupId, favourite);
      await onRefresh();
    } catch (caught) {
      if (
        caught instanceof Error &&
        /no handler registered|setFavourite.*(?:undefined|not a function)|cannot read properties/i.test(
          caught.message,
        )
      ) {
        return;
      }
      const restored = { ...nextOverrides };
      if (previous === undefined) delete restored[groupId];
      else restored[groupId] = previous;
      setFavouriteOverrides(restored);
      window.localStorage.setItem(
        "local-status:favourite-repository-groups",
        JSON.stringify(restored),
      );
      showToast(
        caught instanceof Error
          ? caught.message
          : "Could not update favourites.",
        { tone: "error" },
      );
    } finally {
      setChangeBusy(null);
    }
  }

  async function toggleArchived(repositoryId: string, archived: boolean) {
    const key = `archive:${repositoryId}`;
    const previous = archivedOverrides[repositoryId];
    const nextOverrides = {
      ...archivedOverrides,
      [repositoryId]: archived,
    };
    setChangeBusy(key);
    setToast(null);
    setArchivedOverrides(nextOverrides);
    if (
      archived &&
      selectedRepository &&
      selectedRepository.id === repositoryId
    ) {
      setSelectedId(null);
      setCompareRequest(null);
      setComparison(null);
      setSelectedCommit(null);
      setCommitDetail(null);
    }
    try {
      await api.setArchived(repositoryId, archived);
      showToast(
        archived
          ? "Repository archived. It will be skipped by Git refresh and fetch operations."
          : "Repository restored.",
      );
      await onRefresh();
    } catch (caught) {
      const restored = { ...nextOverrides };
      if (previous === undefined) delete restored[repositoryId];
      else restored[repositoryId] = previous;
      setArchivedOverrides(restored);
      showToast(
        caught instanceof Error
          ? caught.message
          : archived
            ? "Could not archive the repository."
            : "Could not restore the repository.",
        { tone: "error" },
      );
    } finally {
      setChangeBusy(null);
    }
  }

  async function renameRepository(
    repositoryId: string,
    name: string,
  ): Promise<boolean> {
    const previous = repositoryNameOverrides[repositoryId];
    const nextOverrides = {
      ...repositoryNameOverrides,
      [repositoryId]: name,
    };
    setRepositoryNameOverrides(nextOverrides);
    setToast(null);
    try {
      await api.renameRepository(repositoryId, name);
      showToast(`Worktree renamed to ${name}.`);
      return true;
    } catch (caught) {
      const restored = { ...nextOverrides };
      if (previous === undefined) delete restored[repositoryId];
      else restored[repositoryId] = previous;
      setRepositoryNameOverrides(restored);
      showToast(
        caught instanceof Error
          ? caught.message
          : "Could not rename the worktree.",
        { tone: "error" },
      );
      return false;
    }
  }

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
    setSelectedStash(null);
    setContextSearch("");
  }

  async function fetchRepository(repositoryId: string) {
    setFetching(repositoryId);
    setToast(null);
    try {
      const result = await api.fetch(repositoryId);
      showToast(`Fetched ${result.remote} for ${repositoryId}.`);
      await onRefresh();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Fetch failed.", {
        tone: "error",
      });
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
      showToast(
        failures.length
          ? `Fetched ${result.results.length - failures.length} repositories; ${failures.length} need attention.`
          : `Fetched all ${result.results.length} repositories.`,
        failures.length ? { tone: "error" } : undefined,
      );
      await onRefresh();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Fetch all failed.", {
        tone: "error",
      });
    } finally {
      setFetching(null);
    }
  }

  async function performChangeAction(
    action: ChangeAction,
    selection: ChangeSelection,
  ) {
    if (!selectedId) return;
    const key = changeActionKey(action, selection);
    setChangeBusy(key);
    setToast(null);
    try {
      const result =
        action === "stage"
          ? await api.stage(selectedId, selection)
          : action === "unstage"
            ? await api.unstage(selectedId, selection)
            : await api.revert(selectedId, selection);
      if (result.cancelled) return;
      setChanges(result.changes);
      if (
        compareRequest &&
        (compareRequest.scope === selection.scope ||
          (selection.scope === "unstaged" &&
            (compareRequest.scope === "working" ||
              compareRequest.scope === "untracked"))) &&
        (!selection.path && !selection.paths
          ? true
          : selection.path
            ? compareRequest.path === selection.path
            : selection.paths?.includes(compareRequest.path))
      ) {
        const next = result.changes.find(
          (change) => change.path === compareRequest.path,
        );
        setCompareRequest(
          next
            ? {
                path: next.path,
                previousPath: next.previousPath,
                scope: next.scope,
              }
            : null,
        );
      }
      const target = selection.paths?.length
        ? `${selection.paths.length} selected files`
        : selection.path
          ? pathName(selection.path)
        : selection.scope === "unstaged"
          ? "all unstaged changes"
          : `${selection.scope} changes`;
      showToast(
        action === "stage"
          ? `Staged ${target}.`
          : action === "unstage"
            ? `Unstaged ${target}.`
            : `Reverted ${target}.`,
      );
      await onRefresh();
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : `Could not ${action} the changes.`,
        { tone: "error" },
      );
      await onRefresh();
    } finally {
      setChangeBusy(null);
    }
  }

  function openStashModal(path: string | null = null) {
    setStashModalPath(path);
    setStashMessage("");
    setStashIncludeUntracked(true);
    setStashError(null);
  }

  async function refreshStashes(repositoryId: string) {
    const response = await api.stashes(repositoryId);
    setStashes(response.stashes);
    return response.stashes;
  }

  async function createSelectedStash() {
    if (!selectedId || stashModalPath === undefined) return;
    const recoveryAfterStash = syncRecoveryAfterStash;
    setStashBusy("create");
    setStashError(null);
    try {
      const result = await api.createStash(selectedId, {
        message: stashMessage,
        includeUntracked: stashIncludeUntracked,
        path: stashModalPath,
      });
      setChanges(result.changes);
      setStashes((current) => [
        result.stash,
        ...current.filter((stash) => stash.id !== result.stash.id),
      ]);
      setStashModalPath(undefined);
      setStashMessage("");
      showToast(
        result.remainingFiles
          ? `Created ${result.stash.ref}; ${result.remainingFiles} changed ${
              result.remainingFiles === 1 ? "file remains" : "files remain"
            }.`
          : `Created ${result.stash.ref} with ${result.stash.fileCount} ${
              result.stash.fileCount === 1 ? "file" : "files"
            }.`,
        {
          durationMs: 8_000,
          action: recoveryAfterStash
            ? undefined
            : {
                label: "View stash",
                run: () => {
                  setTab("stashes");
                  setSelectedCommit(null);
                  setSelectedStash(result.stash.id);
                  setCompareRequest(null);
                  setToast(null);
                },
              },
        },
      );
      if (
        compareRequest &&
        !result.changes.some((change) => change.path === compareRequest.path)
      ) {
        setCompareRequest(null);
      }
      await onRefresh();
      if (recoveryAfterStash) {
        setSyncRecovery({
          ...recoveryAfterStash,
          workingTreeDirty: result.remainingFiles > 0,
        });
        setSyncRecoveryAfterStash(null);
      }
    } catch (caught) {
      setStashError(readableError(caught, "Could not create the stash."));
    } finally {
      setStashBusy(null);
    }
  }

  function closeStashModal() {
    if (stashBusy === "create") return;
    setStashModalPath(undefined);
    if (syncRecoveryAfterStash) {
      setSyncRecovery(syncRecoveryAfterStash);
      setSyncRecoveryAfterStash(null);
    }
  }

  async function restoreSelectedStash(
    action: "apply" | "pop",
    stash: StashSummary,
  ) {
    if (!selectedId) return;
    setStashBusy(`${action}:${stash.id}`);
    setToast(null);
    try {
      const result =
        action === "apply"
          ? await api.applyStash(selectedId, stash.id)
          : await api.popStash(selectedId, stash.id);
      if (result.outcome === "cancelled") return;
      setChanges(result.changes);
      if (result.outcome === "conflicts") {
        setTab("changes");
        setSelectedStash(null);
        setCompareRequest(null);
        showToast(
          "The stash was kept because restoring it created conflicts. Resolve them in Changes before trying again.",
          { tone: "error", durationMs: 10_000 },
        );
      } else {
        const nextStashes = await refreshStashes(selectedId);
        if (action === "pop") {
          setSelectedStash(nextStashes[0]?.id ?? null);
          setStashDetail(null);
          setCompareRequest(null);
        }
        showToast(
          action === "apply"
            ? `Applied ${stash.ref}; the stash is still available.`
            : result.stashRetained
              ? `Restored ${stash.ref}, but it was kept because the stash list changed.`
              : `Popped ${stash.ref}.`,
          result.stashRetained && action === "pop"
            ? { tone: "error", durationMs: 8_000 }
            : undefined,
        );
      }
      await onRefresh();
    } catch (caught) {
      showToast(readableError(caught, `Could not ${action} the stash.`), {
        tone: "error",
        durationMs: 8_000,
      });
      await onRefresh();
    } finally {
      setStashBusy(null);
    }
  }

  async function deleteSelectedStash(stash: StashSummary) {
    if (!selectedId) return;
    setStashBusy(`drop:${stash.id}`);
    setToast(null);
    try {
      const result = await api.dropStash(selectedId, stash.id);
      if (result.cancelled || !result.dropped) return;
      const nextStashes = await refreshStashes(selectedId);
      setSelectedStash(nextStashes[0]?.id ?? null);
      setStashDetail(null);
      setCompareRequest(null);
      showToast(`Deleted ${stash.ref}.`);
    } catch (caught) {
      showToast(readableError(caught, "Could not delete the stash."), {
        tone: "error",
      });
    } finally {
      setStashBusy(null);
    }
  }

  async function presentSyncResult(result: SyncResult) {
    if (result.outcome === "synced") {
      setSyncRecovery(null);
      setSyncRecoveryAfterStash(null);
      setSyncRecoveryError(null);
      const activity = [
        result.pulled ? `pulled ${result.pulled}` : null,
        result.pushed ? `pushed ${result.pushed}` : null,
      ].filter(Boolean);
      showToast(
        activity.length
          ? `Synced ${result.repositoryId}: ${activity.join(", ")}.`
          : `${result.repositoryId} is already synchronized.`,
      );
      return;
    }

    setSyncRecovery(result);
    setSyncRecoveryError(null);
    if (result.outcome === "diverged") setSyncStrategy("rebase");
    if (result.outcome === "paused" && !aiStatus) {
      try {
        setAiStatus(await api.aiStatus());
      } catch {
        setAiStatus(null);
      }
    }
  }

  async function syncSelectedRepository(
    repositoryId: string,
    strategy?: SyncStrategy,
  ) {
    setSyncing(repositoryId);
    if (!strategy) setToast(null);
    setSyncRecoveryError(null);
    try {
      await presentSyncResult(
        strategy
          ? await api.sync(repositoryId, strategy)
          : await api.sync(repositoryId),
      );
    } catch (caught) {
      const message = readableSyncError(caught);
      if (strategy || syncRecovery) {
        setSyncRecoveryError(message);
        return;
      }
      showToast(message, {
        tone: "error",
        durationMs: 10_000,
        action:
          /^Sync stopped/.test(message) &&
          changes.length &&
          !changes.some((change) => change.scope === "conflict")
            ? {
                label: "Stash changes",
                run: () => {
                  openStashModal();
                  setToast(null);
                },
              }
            : undefined,
      });
    } finally {
      await onRefresh();
      setSyncing(null);
    }
  }

  async function refreshCommitContext(repositoryId: string) {
    setCommitPreparing(true);
    try {
      const context = await api.prepareCommit(repositoryId);
      setCommitContext(context);
      return context;
    } finally {
      setCommitPreparing(false);
    }
  }

  async function openCommitModal() {
    if (!selectedId) return;
    setCommitModalOpen(true);
    setCommitContext(null);
    setCommitMessage("");
    setCommitError(null);
    setAiStatus(null);
    setCommitPreparing(true);
    try {
      const [context, status] = await Promise.all([
        api.prepareCommit(selectedId),
        api.aiStatus(),
      ]);
      setCommitContext(context);
      setAiStatus(status);
    } catch (caught) {
      setCommitError(
        caught instanceof Error
          ? caught.message
          : "The commit window could not be prepared.",
      );
      try {
        setAiStatus(await api.aiStatus());
      } catch {
        setAiStatus(null);
      }
    } finally {
      setCommitPreparing(false);
    }
  }

  function closeCommitModal() {
    if (committing || aiGenerating) return;
    setCommitModalOpen(false);
    setCommitError(null);
  }

  async function locateAiExecutable() {
    if (!aiStatus) return;
    setCommitError(null);
    setSyncRecoveryError(null);
    try {
      setAiStatus(await api.chooseAiExecutable(aiStatus.provider));
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The AI CLI could not be selected.";
      setCommitError(message);
      setSyncRecoveryError(message);
    }
  }

  async function startAiTerminal(action: AiTerminalAction) {
    if (!selectedId || !aiStatus) return;
    const provider = aiStatus.provider;
    setCommitError(null);
    setSyncRecoveryError(null);
    try {
      const session = await onStartAiTerminal(
        selectedId,
        provider,
        action,
        aiStatus.providers[provider].executablePath,
      );
      setAiTerminal({ session, provider, action });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : `Could not open the ${provider === "codex" ? "Codex" : "Claude"} setup terminal.`;
      setCommitError(message);
      setSyncRecoveryError(message);
    }
  }

  async function closeAiTerminal() {
    const action = aiTerminal?.action;
    setAiTerminal(null);
    try {
      setAiStatus(await api.aiStatus());
    } catch {
      // The commit flow remains usable even if provider detection fails.
    }
    if (
      action === "resolve-conflicts" &&
      selectedId &&
      syncRecovery?.outcome === "paused"
    ) {
      try {
        const result = await api.changes(selectedId);
        setChanges(result.changes);
        setSyncRecovery((current) =>
          current?.outcome === "paused"
            ? {
                ...current,
                conflictFiles: result.changes
                  .filter((change) => change.scope === "conflict")
                  .map((change) => change.path),
              }
            : current,
        );
        await onRefresh();
      } catch (caught) {
        setSyncRecoveryError(
          readableError(caught, "Could not refresh the conflicted files."),
        );
      }
    }
  }

  async function changeAiPreferences(provider: AiProvider, model?: string) {
    if (!aiStatus) return;
    setCommitError(null);
    setSyncRecoveryError(null);
    const nextModel =
      model ??
      aiStatus.selectedModels[provider];
    try {
      setAiStatus(await api.setAiPreferences(provider, nextModel));
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The AI preference could not be saved.";
      setCommitError(message);
      setSyncRecoveryError(message);
    }
  }

  async function openPausedRecovery(repository: RepositorySummary) {
    if (!repository.operation) return;
    setSyncing(repository.id);
    setSyncRecoveryError(null);
    try {
      const result = await api.changes(repository.id);
      if (selectedId === repository.id) setChanges(result.changes);
      const paused = pausedResultFor(repository, result.changes);
      if (paused) await presentSyncResult(paused);
    } catch (caught) {
      showToast(
        readableError(caught, "Could not load the paused Git operation."),
        { tone: "error", durationMs: 8_000 },
      );
    } finally {
      setSyncing(null);
    }
  }

  async function startAiConflictResolution(
    recovery: Extract<SyncResult, { outcome: "paused" }> | null =
      syncRecovery?.outcome === "paused" ? syncRecovery : null,
  ) {
    if (!selectedId || !recovery) return;
    setSyncRecovery(recovery);
    let status = aiStatus;
    if (!status) {
      try {
        status = await api.aiStatus();
        setAiStatus(status);
      } catch (caught) {
        setSyncRecoveryError(
          readableError(caught, "Could not check the configured AI provider."),
        );
        return;
      }
    }
    const provider = status.provider;
    setSyncRecoveryError(null);
    try {
      const session = await api.startAiConflictResolution({
        repositoryId: selectedId,
        provider,
      });
      if (!session) return;
      setAiTerminal({ session, provider, action: "resolve-conflicts" });
      setAiStatus((current) =>
        current ? { ...current, conflictDisclosureAccepted: true } : current,
      );
    } catch (caught) {
      setSyncRecoveryError(
        readableError(caught, "Could not open the AI conflict assistant."),
      );
    }
  }

  function stashForSyncRecovery() {
    if (syncRecovery?.outcome === "diverged") {
      setSyncRecoveryAfterStash(syncRecovery);
    }
    setSyncRecovery(null);
    setSyncRecoveryError(null);
    openStashModal();
  }

  function viewSyncConflicts() {
    const firstConflict =
      syncRecovery?.outcome === "paused"
        ? syncRecovery.conflictFiles[0]
        : null;
    setSyncRecovery(null);
    setSyncRecoveryError(null);
    setSelectedCommit(null);
    setSelectedStash(null);
    setCompareRequest(
      firstConflict
        ? {
            path: firstConflict,
            scope: "conflict",
          }
        : null,
    );
    selectTab("changes");
  }

  async function openSyncRecoveryTerminal(
    recovery: Extract<SyncResult, { outcome: "paused" }> | null =
      syncRecovery?.outcome === "paused" ? syncRecovery : null,
  ) {
    if (!selectedId || !recovery) return;
    const command = recovery.conflictFiles.length
      ? "git status"
      : `git ${recovery.operation} --continue`;
    setSyncRecoveryError(null);
    try {
      await onOpenRecoveryTerminal(selectedId, command);
      if (syncRecovery?.outcome === "paused") setSyncRecovery(null);
    } catch (caught) {
      setSyncRecoveryError(
        readableError(caught, "Could not open the recovery terminal."),
      );
    }
  }

  async function generateCommitMessage() {
    if (!selectedId || !commitContext || !aiStatus) return;
    const providerStatus = aiStatus.providers[aiStatus.provider];
    if (!providerStatus.authenticated) return;
    setCommitError(null);
    try {
      if (!aiStatus.disclosureAccepted) {
        const accepted = await api.acceptAiDisclosure(aiStatus.provider);
        if (!accepted) return;
        setAiStatus((current) =>
          current ? { ...current, disclosureAccepted: true } : current,
        );
      }
      const requestId =
        globalThis.crypto?.randomUUID?.() ??
        `commit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setAiRequestId(requestId);
      setAiGenerating(true);
      const result = await api.generateCommitMessage({
        repositoryId: selectedId,
        snapshotId: commitContext.snapshotId,
        requestId,
      });
      setCommitMessage(result.message);
      if (result.patchTruncated) {
        setCommitError(
          `${result.provider === "codex" ? "Codex" : "Claude"} drafted this message from a patch capped at 1 MB. All staged file names and statistics were included; review the draft carefully.`,
        );
      }
    } catch (caught) {
      const detail = readableError(
        caught,
        "AI could not generate a commit message.",
      );
      setCommitError(detail);
      if (/not signed in|complete sign-in/i.test(detail)) {
        try {
          setAiStatus(await api.aiStatus());
        } catch {
          // Keep the actionable generation error visible.
        }
      }
    } finally {
      setAiGenerating(false);
      setAiRequestId(null);
    }
  }

  async function cancelCommitMessageGeneration() {
    if (!aiRequestId) return;
    try {
      await api.cancelCommitMessageGeneration(aiRequestId);
    } catch {
      setCommitError("The AI generation could not be cancelled.");
    }
  }

  async function submitCommit() {
    if (!selectedId || !commitContext || !commitMessage.trim()) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await api.createCommit(selectedId, {
        message: commitMessage,
        snapshotId: commitContext.snapshotId,
      });
      setChanges(result.changes);
      if (
        compareRequest &&
        !result.changes.some(
          (change) =>
            change.path === compareRequest.path &&
            change.scope === compareRequest.scope,
        )
      ) {
        setCompareRequest(null);
      }
      setCommitModalOpen(false);
      showToast(
        `Committed ${result.commit.shortSha}: ${result.commit.subject}`,
      );
      await onRefresh();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Git could not create the commit.";
      setCommitError(message);
      if (message.includes("staged changes changed")) {
        try {
          await refreshCommitContext(selectedId);
        } catch (refreshError) {
          setCommitError(
            refreshError instanceof Error ? refreshError.message : message,
          );
        }
      }
    } finally {
      setCommitting(false);
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

  const rootKind = data?.rootKind ?? "workspace";
  const viewingRepository = rootKind === "repository";
  const stats = useMemo(
    () => ({
      total: activeRepositories.length,
      changed: activeRepositories.filter(
        (repository) => repository.summary.files > 0,
      ).length,
      conflicts: activeRepositories.reduce(
        (total, repository) => total + repository.summary.conflicts,
        0,
      ),
      incoming: activeRepositories.reduce(
        (total, repository) => total + repository.incoming,
        0,
      ),
      outgoing: activeRepositories.reduce(
        (total, repository) => total + repository.outgoing,
        0,
      ),
    }),
    [activeRepositories],
  );

  const filteredFiles = files.filter((path) =>
    path.toLowerCase().includes(contextSearch.toLowerCase()),
  );
  const stagedCount = changes.filter((change) => change.scope === "staged").length;
  const stashCounts = {
    staged: stagedCount,
    unstaged: changes.filter((change) => change.scope === "working").length,
    untracked: changes.filter((change) => change.scope === "untracked").length,
  };
  const hasConflicts = changes.some((change) => change.scope === "conflict");
  const pausedRecovery = selectedRepository
    ? pausedResultFor(selectedRepository)
    : null;
  const conflictProviderLabel =
    aiStatus?.providers[aiStatus.provider].label ?? "AI";
  const conflictProviderReady = Boolean(
    aiStatus?.providers[aiStatus.provider].authenticated,
  );
  const commitDisabledReason = hasConflicts
    ? "Resolve conflicts before committing"
    : stagedCount === 0
      ? "Stage changes before committing"
      : "Commit staged changes";

  const workspaceStyle = {
    "--repo-panel-width": `${repoWidth}px`,
    "--context-panel-width": `${contextWidth}px`,
  } as CSSProperties;

  return (
    <main
      className={`repository-workspace ${
        viewerExpanded ? "is-viewer-expanded" : ""
      } ${viewingRepository ? "is-single-repository" : ""}`}
      style={workspaceStyle}
    >
      <section className="workspace-overview">
        {!viewingRepository && (
          <button
            className="icon-button mobile-menu-button"
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open repositories"
          >
            <Menu size={18} />
          </button>
        )}
        <div className="overview-title">
          <span className="eyebrow">
            {viewingRepository
              ? "Local Git repository"
              : rootKind === "hybrid"
                ? "Git repository workspace"
                : "Local Git workspace"}
          </span>
          <strong>{data?.workspaceName || "Workspace"}</strong>
          {loading && (
            <span>
              {viewingRepository ? "Scanning repository…" : "Scanning repositories…"}
            </span>
          )}
        </div>
        <div className="overview-stats">
          {!viewingRepository && (
            <div>
              <strong>{stats.total}</strong>
              <span>Repositories</span>
            </div>
          )}
          <div
            className={
              (viewingRepository
                ? selectedRepository?.summary.files
                : stats.changed)
                ? "has-signal"
                : ""
            }
          >
            <strong>
              {viewingRepository
                ? selectedRepository?.summary.files ?? 0
                : stats.changed}
            </strong>
            <span>{viewingRepository ? "Changed files" : "Changed"}</span>
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
            disabled={Boolean(fetching || syncing || changeBusy || stashBusy)}
          >
            <CloudDownload className={fetching === "all" ? "is-spinning" : ""} size={15} />
            {fetching === "all"
              ? "Fetching…"
              : viewingRepository
                ? "Fetch"
                : "Fetch all"}
          </button>
        </div>
      </section>

      {(error || toast) && (
        <div
          className={`workspace-toast ${
            error || toast?.tone === "error" ? "is-error" : ""
          }`}
        >
          {error || toast?.tone === "error" ? (
            <AlertTriangle size={15} />
          ) : (
            <Check size={15} />
          )}
          <span>{error || toast?.message}</span>
          {toast?.action && (
            <button
              className="workspace-toast__action"
              type="button"
              onClick={toast.action.run}
            >
              {toast.action.label}
            </button>
          )}
          {toast && (
            <button
              className="workspace-toast__dismiss"
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <section className="workspace-panels" onPointerDown={rememberResizeStart}>
        {!viewingRepository && (
          <>
            <RepositoryNavigator
              repositories={repositories}
              rootKind={rootKind}
              loading={loading}
              selectedId={selectedId}
              onSelect={selectRepository}
              mobileOpen={mobileOpen}
              onCloseMobile={() => setMobileOpen(false)}
              searchInputRef={searchInputRef}
              onToggleFavourite={(groupId, favourite) =>
                void toggleFavourite(groupId, favourite)
              }
              onToggleArchived={(groupId, archived) =>
                void toggleArchived(groupId, archived)
              }
              onRenameRepository={renameRepository}
              onOpenBranches={(repositoryId, anchor) =>
                void openBranchPicker(repositoryId, anchor)
              }
            />
            <ResizeHandle side="repository" onResize={resizeRepo} />
          </>
        )}

        <aside className="context-panel">
          {selectedRepository ? (
            <>
              <div className="repository-header">
                <div className="repository-header__top">
                  <RepositoryMark repository={selectedRepository} size="header" />
                  <div>
                    <div className="repository-header__title">
                      <h2>{repositoryDisplayName(selectedRepository)}</h2>
                      {selectedRepository.isWorkspaceRoot && (
                        <span
                          className="repository-root-badge"
                          title="Selected folder"
                        >
                          Root
                        </span>
                      )}
                    </div>
                    <button
                      className="repository-header__branch"
                      type="button"
                      aria-label={
                        selectedRepository.operation
                          ? `${selectedRepository.operation === "rebase" ? "Rebase" : "Merge"} paused for ${repositoryDisplayName(selectedRepository)}`
                          : `Switch branch for ${repositoryDisplayName(selectedRepository)}`
                      }
                      data-tooltip={
                        selectedRepository.operation
                          ? "Finish or abort the paused operation before switching branches"
                          : "Switch branch"
                      }
                      disabled={Boolean(selectedRepository.operation)}
                      onClick={(event) =>
                        void openBranchPicker(
                          selectedRepository.id,
                          event.currentTarget,
                        )
                      }
                    >
                      <GitBranch size={12} />
                      <span>
                        {selectedRepository.operation
                          ? `${selectedRepository.operation === "rebase" ? "Rebase" : "Merge"} paused`
                          : selectedRepository.detached
                          ? "Detached HEAD"
                          : selectedRepository.branch ||
                            (selectedRepository.unborn
                              ? "No commits yet"
                              : "Unknown branch")}
                      </span>
                      <ChevronDown size={12} />
                    </button>
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
                      disabled={Boolean(fetching || syncing || changeBusy || stashBusy)}
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
                  {selectedRepository.upstream || selectedRepository.operation ? (
                    <button
                      className={`sync-control ${
                        selectedRepository.operation ? "is-paused" : ""
                      }`}
                      type="button"
                      title={
                        selectedRepository.operation
                          ? `Resume ${selectedRepository.operation} recovery`
                          : "Pull incoming changes, then push outgoing changes"
                      }
                      aria-label={
                        selectedRepository.operation
                          ? `Resume ${selectedRepository.operation} recovery: ${selectedRepository.summary.conflicts} conflicts`
                          : `Sync changes: ${selectedRepository.incoming} incoming, ${selectedRepository.outgoing} outgoing`
                      }
                      disabled={Boolean(syncing || fetching || changeBusy || stashBusy)}
                      onClick={() =>
                        selectedRepository.operation
                          ? void openPausedRecovery(selectedRepository)
                          : void syncSelectedRepository(selectedRepository.id)
                      }
                    >
                      <RefreshCw
                        className={
                          syncing === selectedRepository.id ? "is-spinning" : ""
                        }
                        size={11}
                      />
                      {selectedRepository.operation ? (
                        <span>
                          {selectedRepository.operation === "rebase"
                            ? "Rebase paused"
                            : "Merge paused"}
                        </span>
                      ) : (
                        <>
                          <span>
                            <ArrowDown size={11} /> {selectedRepository.incoming} incoming
                          </span>
                          <span>
                            <ArrowUp size={11} /> {selectedRepository.outgoing} outgoing
                          </span>
                        </>
                      )}
                    </button>
                  ) : (
                    <span className="no-upstream">No upstream configured</span>
                  )}
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
                    ["changes", selectedRepository.summary.files],
                    ["commits", null],
                    ["stashes", stashes.length || null],
                    ["files", null],
                  ] as const
                ).map(([value, count]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    className={[
                      tab === value ? "is-active" : "",
                      count !== null ? "has-count" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={value}
                    onClick={() => selectTab(value)}
                  >
                    {value[0].toUpperCase() + value.slice(1)}
                    {count !== null && <span>{count}</span>}
                  </button>
                ))}
              </div>
              {tab === "changes" &&
                selectedRepository.operation &&
                pausedRecovery && (
                  <PausedSyncBanner
                    repository={selectedRepository}
                    providerLabel={conflictProviderLabel}
                    aiReady={conflictProviderReady}
                    busy={Boolean(
                      syncing || fetching || changeBusy || stashBusy,
                    )}
                    onShowRecovery={() =>
                      void openPausedRecovery(selectedRepository)
                    }
                    onOpenTerminal={() =>
                      void openSyncRecoveryTerminal(pausedRecovery)
                    }
                    onStartAi={() =>
                      conflictProviderReady
                        ? void startAiConflictResolution(pausedRecovery)
                        : void openPausedRecovery(selectedRepository)
                    }
                  />
                )}
              {tab === "changes" && (
                <div className="commit-toolbar">
                  <span>
                    <GitCommitHorizontal size={13} />
                    {stagedCount
                      ? `${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`
                      : "No staged changes"}
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    title={
                      hasConflicts
                        ? "Resolve conflicts before creating a stash"
                        : changes.length
                          ? "Stash all current changes"
                          : "There are no changes to stash"
                    }
                    disabled={Boolean(
                      !changes.length ||
                        hasConflicts ||
                        changeBusy ||
                        stashBusy ||
                        syncing ||
                        fetching ||
                        committing,
                    )}
                    onClick={() => openStashModal()}
                  >
                    <Archive size={13} />
                    Stash
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    title={commitDisabledReason}
                    disabled={Boolean(
                      !stagedCount ||
                        hasConflicts ||
                        changeBusy ||
                        stashBusy ||
                        syncing ||
                        fetching ||
                        committing,
                    )}
                    onClick={() => void openCommitModal()}
                  >
                    <GitCommitHorizontal size={13} />
                    Commit
                  </button>
                </div>
              )}
              <label className="context-search">
                <Search size={13} />
                <input
                  ref={contextSearchInputRef}
                  value={contextSearch}
                  onChange={(event) => setContextSearch(event.target.value)}
                  placeholder={
                    tab === "changes"
                      ? "Filter changed files"
                      : tab === "commits"
                        ? "Filter commits"
                        : tab === "stashes"
                          ? "Filter stashes"
                          : "Filter files"
                  }
                  aria-label={
                    tab === "changes"
                      ? "Filter changed files"
                      : tab === "commits"
                        ? "Filter commits"
                        : tab === "stashes"
                          ? "Filter stashes"
                          : "Filter files"
                  }
                />
              </label>
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
                    key={selectedId}
                    changes={changes}
                    selected={compareRequest}
                    search={contextSearch}
                    busy={changeBusy}
                    disabled={Boolean(syncing || fetching || stashBusy)}
                    onSelect={(change) =>
                      setCompareRequest({
                        path: change.path,
                        previousPath: change.previousPath,
                        scope: change.scope,
                      })
                    }
                    onAction={(action, selection) =>
                      void performChangeAction(action, selection)
                    }
                    onStash={(path) => openStashModal(path)}
                  />
                ) : tab === "commits" ? (
                  <CommitList
                    commits={commits}
                    selectedSha={selectedCommit}
                    search={contextSearch}
                    onSelect={(commit) => {
                      setSelectedCommit(commit.sha);
                      setCompareRequest(null);
                    }}
                  />
                ) : tab === "stashes" ? (
                  <StashList
                    stashes={stashes}
                    selectedId={selectedStash}
                    search={contextSearch}
                    onSelect={(stash) => {
                      setSelectedStash(stash.id);
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
            (comparison && compareRequest) ||
            (tab === "commits" && commitDetail) ||
            (tab === "stashes" && stashDetail)
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
                  title="Back to file list"
                  onClick={() => setCompareRequest(null)}
                >
                  <ChevronLeft size={16} />
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
                <button
                  className="icon-button viewer-expand-button desktop-only"
                  type="button"
                  aria-label={
                    viewerExpanded ? "Restore diff panels" : "Expand diff viewer"
                  }
                  data-tooltip={
                    viewerExpanded ? "Restore panels (Esc)" : "Expand diff viewer"
                  }
                  onClick={() => setViewerExpanded((current) => !current)}
                >
                  {viewerExpanded ? (
                    <Minimize2 size={16} />
                  ) : (
                    <Maximize2 size={16} />
                  )}
                </button>
              </div>
              <Suspense
                fallback={
                  <div className="viewer-empty">
                    <RefreshCw className="is-spinning" size={22} />
                    <h3>Preparing the diff viewer</h3>
                  </div>
                }
              >
                <MonacoDiff
                  comparison={comparison}
                  theme={theme}
                  colorScheme={colorScheme}
                  findRequest={viewerFindRequest}
                />
              </Suspense>
            </>
          ) : tab === "stashes" && stashDetail ? (
            <div className="commit-detail stash-detail">
              <div className="commit-detail__hero">
                <button
                  className="icon-button viewer-back-button mobile-only"
                  type="button"
                  aria-label="Back to stashes"
                  title="Back to stashes"
                  onClick={() => setSelectedStash(null)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="commit-detail__icon stash-detail__icon">
                  <Archive size={21} />
                </span>
                <div>
                  <p className="eyebrow">{stashDetail.stash.ref}</p>
                  <h2>{stashDetail.stash.message}</h2>
                  <span>
                    {stashDetail.stash.branch || "Detached HEAD"} · saved{" "}
                    {exactDate(stashDetail.stash.createdAt)}
                  </span>
                </div>
              </div>
              <div className="stash-detail__actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={Boolean(stashBusy)}
                  onClick={() =>
                    void restoreSelectedStash("apply", stashDetail.stash)
                  }
                >
                  <ArchiveRestore size={14} />
                  {stashBusy === `apply:${stashDetail.stash.id}`
                    ? "Applying…"
                    : "Apply"}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={Boolean(stashBusy)}
                  onClick={() =>
                    void restoreSelectedStash("pop", stashDetail.stash)
                  }
                >
                  <ArchiveRestore size={14} />
                  {stashBusy === `pop:${stashDetail.stash.id}`
                    ? "Popping…"
                    : "Pop"}
                </button>
                <button
                  className="secondary-button stash-detail__delete"
                  type="button"
                  disabled={Boolean(stashBusy)}
                  onClick={() => void deleteSelectedStash(stashDetail.stash)}
                >
                  <Trash2 size={14} />
                  {stashBusy === `drop:${stashDetail.stash.id}`
                    ? "Deleting…"
                    : "Delete"}
                </button>
              </div>
              <div className="commit-files-head">
                <strong>{stashDetail.files.length} saved files</strong>
                <span>Select a file to compare it with the stash base.</span>
              </div>
              <div className="commit-files">
                {stashDetail.files.map((file) => (
                  <button
                    type="button"
                    key={`${file.status}:${file.previousPath}:${file.path}`}
                    onClick={() =>
                      setCompareRequest({
                        path: file.path,
                        previousPath: file.previousPath,
                        scope: "stash",
                        stash: stashDetail.stash.id,
                      })
                    }
                  >
                    <span className={`change-kind change-kind--${file.status}`}>
                      {file.status}
                    </span>
                    <File size={14} />
                    <span>
                      {file.previousPath
                        ? `${file.previousPath} → ${file.path}`
                        : file.path}
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            </div>
          ) : tab === "commits" && commitDetail ? (
            <div className="commit-detail">
              <div className="commit-detail__hero">
                <button
                  className="icon-button viewer-back-button mobile-only"
                  type="button"
                  aria-label="Back to commits"
                  title="Back to commits"
                  onClick={() => setSelectedCommit(null)}
                >
                  <ChevronLeft size={16} />
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
              <p className="eyebrow">Diff viewer</p>
              <h2>No file selected</h2>
            </div>
          )}
        </section>
      </section>
      {mobileOpen && !viewingRepository && (
        <button
          className="mobile-scrim"
          type="button"
          aria-label="Close repositories"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {stashModalPath !== undefined && selectedId && (
        <StashModal
          repositoryId={selectedId}
          path={stashModalPath}
          message={stashMessage}
          includeUntracked={stashIncludeUntracked}
          counts={stashCounts}
          error={stashError}
          creating={stashBusy === "create"}
          onMessageChange={setStashMessage}
          onIncludeUntrackedChange={setStashIncludeUntracked}
          onClose={closeStashModal}
          onCreate={() => void createSelectedStash()}
        />
      )}
      {syncRecovery && (
        <SyncRecoveryModal
          result={syncRecovery}
          strategy={syncStrategy}
          busy={syncing === syncRecovery.repositoryId}
          error={syncRecoveryError}
          aiStatus={aiStatus}
          suspended={aiTerminal?.action === "resolve-conflicts"}
          onStrategyChange={setSyncStrategy}
          onResolve={() =>
            void syncSelectedRepository(
              syncRecovery.repositoryId,
              syncStrategy,
            )
          }
          onClose={() => {
            if (!syncing) {
              setSyncRecovery(null);
              setSyncRecoveryError(null);
            }
          }}
          onStash={stashForSyncRecovery}
          onViewConflicts={viewSyncConflicts}
          onOpenTerminal={() => void openSyncRecoveryTerminal()}
          onStartAi={() => void startAiConflictResolution()}
          onProviderChange={(provider) => void changeAiPreferences(provider)}
          onModelChange={(model) =>
            aiStatus && void changeAiPreferences(aiStatus.provider, model)
          }
          onInstallAi={() => void startAiTerminal("install")}
          onSignInAi={() => void startAiTerminal("login")}
          onLocateAi={() => void locateAiExecutable()}
        />
      )}
      {commitModalOpen && (
        <CommitModal
          context={commitContext}
          message={commitMessage}
          error={commitError}
          aiStatus={aiStatus}
          preparing={commitPreparing}
          committing={committing}
          generating={aiGenerating}
          suspended={Boolean(aiTerminal)}
          onMessageChange={setCommitMessage}
          onClose={closeCommitModal}
          onCommit={() => void submitCommit()}
          onGenerate={() => void generateCommitMessage()}
          onCancelGeneration={() => void cancelCommitMessageGeneration()}
          onProviderChange={(provider) => void changeAiPreferences(provider)}
          onModelChange={(model) =>
            aiStatus && void changeAiPreferences(aiStatus.provider, model)
          }
          onInstallAi={() => void startAiTerminal("install")}
          onSignInAi={() => void startAiTerminal("login")}
          onLocateAi={() => void locateAiExecutable()}
        />
      )}
      {aiTerminal && (
        <AiTerminalModal
          session={aiTerminal.session}
          provider={aiTerminal.provider}
          action={aiTerminal.action}
          theme={theme}
          colorScheme={colorScheme}
          findRequest={findRequest}
          onClose={() => void closeAiTerminal()}
        />
      )}
      {branchMenu && (
        <BranchPicker
          key={branchMenu.repositoryId}
          repository={
            repositories.find(
              (repository) => repository.id === branchMenu.repositoryId,
            ) ?? selectedRepository!
          }
          branches={branches}
          loading={branchesLoading}
          busy={branchBusy}
          anchor={branchMenu.anchor}
          menuRef={branchMenuRef}
          onSelect={(branch) => void switchBranch(branch)}
        />
      )}
    </main>
  );
}
