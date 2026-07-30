import {
  AlertTriangle,
  FileCode2,
  FolderSearch2,
  LoaderCircle,
  Search,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { WorkspaceFile, WorkspaceFilesResponse } from "../types";
import {
  quickOpenFileName,
  quickOpenParentPath,
  rankWorkspaceFiles,
} from "./quick-open-ranking";

const RECENT_FILES_KEY = "local-status:recent-files";
const CACHE_MS = 10_000;
const MAX_RECENT = 10;

interface RecentWorkspaceFile extends WorkspaceFile {
  workspacePath: string;
}

function loadRecentFiles(workspacePath: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_FILES_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is RecentWorkspaceFile =>
          entry &&
          typeof entry === "object" &&
          entry.workspacePath === workspacePath &&
          typeof entry.repositoryId === "string" &&
          typeof entry.path === "string",
      )
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function rememberFile(workspacePath: string, file: WorkspaceFile) {
  let entries: RecentWorkspaceFile[] = [];
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_FILES_KEY) || "[]");
    if (Array.isArray(value)) {
      entries = value.filter(
        (entry): entry is RecentWorkspaceFile =>
          entry &&
          typeof entry === "object" &&
          typeof entry.workspacePath === "string" &&
          typeof entry.repositoryId === "string" &&
          typeof entry.path === "string",
      );
    }
  } catch {
    entries = [];
  }
  const next = [
    { workspacePath, ...file },
    ...entries.filter(
      (entry) =>
        entry.workspacePath !== workspacePath ||
        entry.repositoryId !== file.repositoryId ||
        entry.path !== file.path,
    ),
  ].slice(0, 50);
  window.localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
}

export function QuickOpen({
  open,
  workspacePath,
  selectedRepositoryId,
  onClose,
  onOpen,
}: {
  open: boolean;
  workspacePath: string;
  selectedRepositoryId: string | null;
  onClose: () => void;
  onOpen: (file: WorkspaceFile) => void;
}) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<WorkspaceFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const cacheRef = useRef<{
    workspacePath: string;
    loadedAt: number;
    response: WorkspaceFilesResponse;
  } | null>(null);

  useEffect(() => {
    cacheRef.current = null;
    setResponse(null);
  }, [workspacePath]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveIndex(0);
    setLoadError(null);
    inputRef.current?.focus();

    const cached = cacheRef.current;
    if (
      cached &&
      cached.workspacePath === workspacePath &&
      Date.now() - cached.loadedAt < CACHE_MS
    ) {
      setResponse(cached.response);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void api
      .workspaceFiles()
      .then((next) => {
        cacheRef.current = {
          workspacePath,
          loadedAt: Date.now(),
          response: next,
        };
        if (!cancelled) setResponse(next);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadError(
            caught instanceof Error ? caught.message : "Could not index workspace files.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspacePath]);

  useEffect(() => {
    if (open) return;
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restore?.isConnected) window.requestAnimationFrame(() => restore.focus());
  }, [open]);

  const results = useMemo(() => {
    if (query.trim()) {
      return rankWorkspaceFiles(
        response?.files ?? [],
        query,
        selectedRepositoryId,
      );
    }
    const available = new Set(
      (response?.files ?? []).map((file) => `${file.repositoryId}\0${file.path}`),
    );
    return loadRecentFiles(workspacePath)
      .filter(
        (file) =>
          !response ||
          available.has(`${file.repositoryId}\0${file.path}`),
      )
      .slice(0, MAX_RECENT);
  }, [query, response, selectedRepositoryId, workspacePath]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(results.length - 1, 0)));
  }, [results.length]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  function close() {
    onClose();
  }

  function select(file: WorkspaceFile) {
    rememberFile(workspacePath, file);
    onOpen(file);
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      select(results[activeIndex]);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), button:not(:disabled)',
      ) ?? []),
    ];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) close();
  }

  if (!open) return null;

  return createPortal(
    <div className="quick-open-backdrop" onMouseDown={closeFromBackdrop}>
      <section
        ref={dialogRef}
        className="quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Open"
        onKeyDown={handleKeyDown}
      >
        <label className="quick-open__search">
          <Search size={17} />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label="Search files"
            placeholder="Search files by name or path"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
          <kbd>⌘P</kbd>
        </label>

        <div className="quick-open__body">
          {loading && !response ? (
            <div className="quick-open__state">
              <LoaderCircle className="is-spinning" size={18} />
              Indexing workspace files…
            </div>
          ) : loadError ? (
            <div className="quick-open__state is-error">
              <AlertTriangle size={18} />
              {loadError}
            </div>
          ) : results.length ? (
            <div className="quick-open__results" role="listbox" aria-label="Files">
              {results.map((file, index) => (
                <button
                  ref={(button) => {
                    resultRefs.current[index] = button;
                  }}
                  key={`${file.repositoryId}:${file.path}`}
                  className={`quick-open__result ${
                    index === activeIndex ? "is-active" : ""
                  }`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => select(file)}
                >
                  <FileCode2 size={16} />
                  <span>
                    <strong>{quickOpenFileName(file.path)}</strong>
                    <small>{quickOpenParentPath(file.path) || "/"}</small>
                  </span>
                  <em>{file.repositoryId}</em>
                </button>
              ))}
            </div>
          ) : (
            <div className="quick-open__state">
              <FolderSearch2 size={20} />
              {query.trim()
                ? "No matching files"
                : "Type to search workspace files"}
            </div>
          )}
        </div>

        {response &&
          (response.truncated || response.errors.length > 0) && (
          <div className="quick-open__notice">
            {response.truncated && "Showing results from the first 100,000 files."}
            {response.truncated && response.errors.length > 0 && " "}
            {response.errors.length > 0 &&
              `${response.errors.length} ${
                response.errors.length === 1 ? "repository was" : "repositories were"
              } unavailable.`}
          </div>
          )}
      </section>
    </div>,
    document.body,
  );
}
