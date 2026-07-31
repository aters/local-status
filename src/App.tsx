import {
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Settings,
  HardDrive,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { QuickOpen } from "./components/QuickOpen";
import { RepositoryWorkspace } from "./components/RepositoryWorkspace";
import { PullRequestsView } from "./components/PullRequestsView";
import { ServicesView } from "./components/ServicesView";
import { SettingsView } from "./components/SettingsView";
import { AppTooltip } from "./components/AppTooltip";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { routeParams, updateRoute } from "./route";
import {
  applyThemeAttributes,
  browserSystemAppearance,
  getThemeDefinition,
  normalizeAppearanceMode,
  normalizeTheme,
  resolveColorScheme,
} from "./theme";
import type {
  AppearanceMode,
  AiProvider,
  AiTerminalAction,
  AppShortcut,
  RepositoriesResponse,
  TerminalKind,
  TerminalSession,
  Theme,
  SystemAppearance,
  WorkspaceFile,
  WorkspaceState,
} from "./types";

type AppView = "repositories" | "pull-requests" | "services" | "settings";

function ProductLogo({ className }: { className: string }) {
  return (
    <img
      className={className}
      src="/local-status-logo.png"
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}

function initialView(): AppView {
  const value = routeParams().get("view");
  return value === "pull-requests" ||
    value === "services" ||
    value === "settings"
    ? value
    : "repositories";
}

function shellArgument(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appMenuOpen() {
  return Boolean(
    document.querySelector(
      '.workspace-menu[role="menu"], .repository-run-menu[role="menu"]',
    ),
  );
}

function Onboarding({
  state,
  busy,
  error,
  onChoose,
  onOpenRecent,
}: {
  state: WorkspaceState;
  busy: boolean;
  error: string | null;
  onChoose: () => Promise<boolean>;
  onOpenRecent: (path: string) => Promise<boolean>;
}) {
  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <ProductLogo className="onboarding-mark" />
        <p className="eyebrow">Local-first development workspace</p>
        <h1>Every repository, one clear view.</h1>
        <p className="onboarding-copy">
          Choose a Git repository or a folder containing repositories. Local Status
          will show working changes, commits, file trees and interactive terminals
          without sending anything off this machine.
        </p>
        {error && <div className="onboarding-error">{error}</div>}
        <button
          className="choose-workspace-button"
          type="button"
          disabled={busy}
          onClick={() => void onChoose()}
        >
          <FolderOpen size={18} />
          {busy ? "Opening…" : "Choose repository or workspace"}
        </button>
        {state.recent.length > 0 && (
          <div className="recent-workspaces">
            <span>Recent workspaces</span>
            {state.recent.map((workspace) => (
              <button
                type="button"
                key={workspace.path}
                onClick={() => void onOpenRecent(workspace.path)}
                disabled={busy}
              >
                <HardDrive size={15} />
                <span>
                  <strong>{workspace.name}</strong>
                  <small>{workspace.path}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="onboarding-promises">
          <span>
            <ShieldCheck size={16} /> Git data stays local
          </span>
          <span>
            <LockKeyhole size={16} /> No account or telemetry
          </span>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [view, setView] = useState<AppView>(initialView);
  const [appearance, setAppearance] = useState<SystemAppearance>(
    browserSystemAppearance,
  );
  const [liquidGlassAppearance, setLiquidGlassAppearance] =
    useState<AppearanceMode>(() =>
      normalizeAppearanceMode(
        window.localStorage.getItem(
          "local-status:liquid-glass-appearance",
        ),
      ),
    );
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = normalizeTheme(
      window.localStorage.getItem("local-status:theme"),
    );
    applyThemeAttributes(initial, appearance, liquidGlassAppearance);
    return initial;
  });
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [repositories, setRepositories] = useState<RepositoriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => routeParams().get("terminal"),
  );
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [findRequest, setFindRequest] = useState(0);
  const [openFileRequest, setOpenFileRequest] = useState<
    (WorkspaceFile & { requestId: number }) | null
  >(null);
  const workspacePath = workspace?.current?.path ?? null;
  const rootKind = repositories?.rootKind ?? "workspace";
  const viewingRepository = rootKind === "repository";
  const viewingHybrid = rootKind === "hybrid";
  const resolvedColorScheme = resolveColorScheme(
    theme,
    appearance,
    liquidGlassAppearance,
  );

  const refreshRepositories = useCallback(async () => {
    setRepositoryError(null);
    try {
      setRepositories(await api.repositories());
    } catch (caught) {
      setRepositoryError(
        caught instanceof Error ? caught.message : "Could not scan local repositories.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const applyWorkspaceState = useCallback(
    async (next: WorkspaceState) => {
      setWorkspace(next);
      setRepositories(null);
      if (next.current) {
        setLoading(true);
        await refreshRepositories();
      } else {
        setLoading(false);
      }
    },
    [refreshRepositories],
  );

  useEffect(() => {
    void api
      .workspace()
      .then(applyWorkspaceState)
      .catch((caught) => {
        setWorkspaceError(
          caught instanceof Error ? caught.message : "Could not load workspace settings.",
        );
        setWorkspace({ current: null, recent: [] });
        setLoading(false);
      });
  }, [applyWorkspaceState]);

  useEffect(() => {
    void api
      .preferences()
      .then((preferences) => {
        setTheme(preferences.theme);
        setLiquidGlassAppearance(preferences.liquidGlassAppearance);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    applyThemeAttributes(theme, appearance, liquidGlassAppearance);
    window.localStorage.setItem("local-status:theme", theme);
    window.localStorage.setItem(
      "local-status:liquid-glass-appearance",
      liquidGlassAppearance,
    );
  }, [appearance, liquidGlassAppearance, theme]);

  useEffect(() => {
    let active = true;
    const applyAppearance = (next: SystemAppearance) => {
      if (active) setAppearance(next);
    };
    void api.appearance().then(applyAppearance).catch(() => undefined);
    api.onAppearanceChange(applyAppearance);

    const mediaQueries = [
      window.matchMedia?.("(prefers-color-scheme: dark)"),
      window.matchMedia?.("(prefers-contrast: more)"),
    ].filter((query): query is MediaQueryList => Boolean(query));
    const applyBrowserAppearance = () => {
      setAppearance((current) => ({
        ...browserSystemAppearance(),
        reducedTransparency: current.reducedTransparency,
      }));
    };
    for (const query of mediaQueries) {
      query.addEventListener("change", applyBrowserAppearance);
    }
    return () => {
      active = false;
      api.offAppearanceChange(applyAppearance);
      for (const query of mediaQueries) {
        query.removeEventListener("change", applyBrowserAppearance);
      }
    };
  }, []);

  useEffect(() => {
    if (getThemeDefinition(theme).material !== "liquid-glass") return;
    const surfaceSelector = [
      ".app-header",
      ".app-nav",
      ".workspace-overview",
      ".repo-panel",
      ".context-tabs",
      ".filter-strip",
      ".viewer-titlebar",
      ".diff-toolbar",
      ".services-toolbar",
      ".session-panel__header",
      ".terminal-titlebar",
      ".pull-requests-toolbar",
      ".workspace-menu",
      ".branch-picker",
      ".repository-run-menu",
      ".repository-context-menu",
      ".quick-open",
      ".commit-modal",
      ".ai-terminal-modal",
      ".commit-modal__ai-popover",
      ".app-tooltip",
      ".workspace-toast",
    ].join(",");
    let activeSurface: HTMLElement | null = null;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const paint = () => {
      frame = 0;
      if (!activeSurface) return;
      const bounds = activeSurface.getBoundingClientRect();
      activeSurface.style.setProperty(
        "--liquid-pointer-x",
        `${pointerX - bounds.left}px`,
      );
      activeSurface.style.setProperty(
        "--liquid-pointer-y",
        `${pointerY - bounds.top}px`,
      );
    };
    const trackPointer = (event: PointerEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(surfaceSelector)
          : null;
      if (activeSurface !== target) {
        activeSurface?.style.removeProperty("--liquid-pointer-x");
        activeSurface?.style.removeProperty("--liquid-pointer-y");
        activeSurface = target;
      }
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (activeSurface && !frame) frame = window.requestAnimationFrame(paint);
    };
    document.addEventListener("pointermove", trackPointer, { passive: true });
    return () => {
      document.removeEventListener("pointermove", trackPointer);
      if (frame) window.cancelAnimationFrame(frame);
      activeSurface?.style.removeProperty("--liquid-pointer-x");
      activeSurface?.style.removeProperty("--liquid-pointer-y");
    };
  }, [theme]);

  useEffect(() => {
    if (!workspacePath) return;
    const interval = window.setInterval(() => void refreshRepositories(), 10_000);
    const focus = () => void refreshRepositories();
    window.addEventListener("focus", focus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [refreshRepositories, workspacePath]);

  const handleShortcut = useCallback(
    (shortcut: AppShortcut) => {
      if (shortcut === "quick-open") {
        if (quickOpenOpen) {
          document.querySelector<HTMLInputElement>(".quick-open__search input")?.focus();
          return;
        }
        if (document.querySelector('[aria-modal="true"]') || appMenuOpen()) return;
        setQuickOpenOpen(true);
        return;
      }
      if (quickOpenOpen) return;
      const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
      if (modal && !modal.classList.contains("ai-terminal-modal")) return;
      if (appMenuOpen()) return;
      setFindRequest((current) => current + 1);
    },
    [quickOpenOpen],
  );

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "p" && key !== "f") return;
      event.preventDefault();
      handleShortcut(key === "p" ? "quick-open" : "find");
    }
    const handleNativeShortcut = (shortcut: AppShortcut) => handleShortcut(shortcut);
    window.addEventListener("keydown", handleKeyboard, true);
    window.localStatus.shortcuts.onRequest(handleNativeShortcut);
    return () => {
      window.removeEventListener("keydown", handleKeyboard, true);
      window.localStatus.shortcuts.offRequest(handleNativeShortcut);
    };
  }, [handleShortcut]);

  async function chooseWorkspace(): Promise<boolean> {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const next = await api.chooseWorkspace();
      if (!next) return false;
      if (next.current?.path === workspacePath) {
        setWorkspace(next);
        return true;
      }
      await applyWorkspaceState(next);
      return true;
    } catch (caught) {
      setWorkspaceError(
        caught instanceof Error ? caught.message : "Could not open that workspace.",
      );
      return false;
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function openRecent(path: string): Promise<boolean> {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const next = await api.openWorkspace(path);
      if (!next) return false;
      if (next.current?.path === workspacePath) {
        setWorkspace(next);
        return true;
      }
      await applyWorkspaceState(next);
      return true;
    } catch (caught) {
      setWorkspaceError(
        caught instanceof Error ? caught.message : "That workspace is no longer available.",
      );
      return false;
    } finally {
      setWorkspaceBusy(false);
    }
  }

  function selectView(next: AppView) {
    setView(next);
    updateRoute({ view: next }, "push");
  }

  async function changeTheme(next: Theme) {
    const previous = theme;
    setTheme(next);
    try {
      const preferences = await api.setTheme(next);
      setTheme(preferences.theme);
    } catch (caught) {
      if (
        caught instanceof Error &&
        /no handler registered|preferences.*undefined|cannot read properties/i.test(
          caught.message,
        )
      ) {
        return;
      }
      setTheme(previous);
      throw caught;
    }
  }

  async function changeLiquidGlassAppearance(next: AppearanceMode) {
    const previous = liquidGlassAppearance;
    setLiquidGlassAppearance(next);
    try {
      const preferences = await api.setLiquidGlassAppearance(next);
      setLiquidGlassAppearance(preferences.liquidGlassAppearance);
    } catch (caught) {
      if (
        caught instanceof Error &&
        /no handler registered|preferences.*undefined|cannot read properties/i.test(
          caught.message,
        )
      ) {
        return;
      }
      setLiquidGlassAppearance(previous);
      throw caught;
    }
  }

  async function startTerminal(
    repositoryId: string,
    kind: TerminalKind,
    option?: string,
  ) {
    const session = await api.createTerminal({
      repositoryId,
      kind,
      scriptName: kind === "script" ? option : undefined,
      profileId: kind === "profile" ? option : undefined,
    });
    setActiveSessionId(session.id);
    setView("services");
    updateRoute({ view: "services", terminal: session.id }, "push");
  }

  async function openRecoveryTerminal(
    repositoryId: string,
    command: string,
  ) {
    const session = await api.createTerminal({
      repositoryId,
      kind: "shell",
    });
    const namedSession = await api.renameTerminal(
      session.id,
      `${repositoryId} · Sync recovery`,
    );
    await api.writeTerminal(namedSession.id, command);
    setActiveSessionId(namedSession.id);
    setView("services");
    updateRoute({ view: "services", terminal: namedSession.id }, "push");
  }

  async function startAiTerminal(
    repositoryId: string,
    provider: AiProvider,
    action: AiTerminalAction,
    executablePath: string | null,
  ): Promise<TerminalSession> {
    const providerLabel = provider === "codex" ? "Codex" : "Claude";
    const title =
      action === "install"
        ? `Install ${providerLabel} CLI`
        : `Sign in to ${providerLabel}`;
    const session = await api.createTerminal({
      repositoryId,
      kind: "shell",
    });
    const namedSession = await api.renameTerminal(session.id, title);

    let command: string;
    if (action === "install") {
      if (provider !== "claude") {
        throw new Error("Automatic installation is not available for this provider.");
      }
      command =
        'curl -fsSL https://claude.ai/install.sh | bash && "$HOME/.local/bin/claude" auth login --claudeai';
    } else {
      const executable = executablePath
        ? shellArgument(executablePath)
        : provider;
      command =
        provider === "codex"
          ? `${executable} login`
          : `${executable} auth login --claudeai`;
    }
    await api.writeTerminal(session.id, `${command}\r`);
    return namedSession;
  }

  if (!workspace) {
    return (
      <div className="app-boot">
        <ProductLogo className="brand-mark" />
        <strong>Opening Local Status…</strong>
      </div>
    );
  }

  if (!workspace.current) {
    return (
      <Onboarding
        state={workspace}
        busy={workspaceBusy}
        error={workspaceError}
        onChoose={chooseWorkspace}
        onOpenRecent={openRecent}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppTooltip />
      <header className="app-header">
        <div className="app-brand">
          <ProductLogo className="brand-mark" />
          <div>
            <strong>Local Status</strong>
            <span>
              {viewingRepository
                ? "Private local repository"
                : viewingHybrid
                  ? "Repository workspace"
                  : "Private desktop workspace"}
            </span>
          </div>
        </div>
        <nav
          className="app-nav"
          aria-label={
            viewingRepository
              ? "Repository sections"
              : viewingHybrid
                ? "Repository workspace sections"
                : "Workspace sections"
          }
        >
          <button
            type="button"
            aria-label={
              viewingRepository
                ? "Repository"
                : "Repositories"
            }
            className={view === "repositories" ? "is-active" : ""}
            onClick={() => selectView("repositories")}
          >
            <GitBranch size={15} />
            <span>
              {viewingRepository
                ? "Repository"
                : "Repositories"}
            </span>
          </button>
          <button
            type="button"
            aria-label="Pull Requests"
            className={view === "pull-requests" ? "is-active" : ""}
            onClick={() => selectView("pull-requests")}
          >
            <GitPullRequest size={15} />
            <span>Pull Requests</span>
          </button>
          <button
            type="button"
            aria-label="Services"
            className={view === "services" ? "is-active" : ""}
            onClick={() => selectView("services")}
          >
            <ServerCog size={15} />
            <span>Services</span>
          </button>
        </nav>
        <div className="app-header__actions">
          <WorkspaceSwitcher
            current={workspace.current}
            rootKind={rootKind}
            recent={workspace.recent}
            busy={workspaceBusy}
            error={workspaceError}
            onChoose={chooseWorkspace}
            onOpenRecent={openRecent}
            onClearError={() => setWorkspaceError(null)}
          />
          <button
            className={`icon-button app-settings-button ${
              view === "settings" ? "is-active" : ""
            }`}
            type="button"
            aria-label="Settings"
            data-tooltip="Settings"
            onClick={() => selectView("settings")}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {view === "repositories" ? (
        <RepositoryWorkspace
          data={repositories}
          loading={loading}
          error={repositoryError}
          onRefresh={refreshRepositories}
          onStartTerminal={startTerminal}
          onStartAiTerminal={startAiTerminal}
          onOpenRecoveryTerminal={openRecoveryTerminal}
          theme={theme}
          colorScheme={resolvedColorScheme}
          findRequest={findRequest}
          openFileRequest={openFileRequest}
        />
      ) : view === "pull-requests" ? (
        <PullRequestsView
          key={workspace.current.path}
          workspacePath={workspace.current.path}
        />
      ) : view === "services" ? (
        <ServicesView
          repositories={
            repositories?.repositories.filter(
              (repository) => !repository.archived,
            ) ?? []
          }
          activeSessionId={activeSessionId}
          onActiveSessionChange={(sessionId) => {
            setActiveSessionId(sessionId);
            updateRoute({ view: "services", terminal: sessionId });
          }}
          onStartTerminal={startTerminal}
          theme={theme}
          colorScheme={resolvedColorScheme}
          findRequest={findRequest}
        />
      ) : (
        <SettingsView
          theme={theme}
          liquidGlassAppearance={liquidGlassAppearance}
          onThemeChange={changeTheme}
          onLiquidGlassAppearanceChange={changeLiquidGlassAppearance}
        />
      )}
      <QuickOpen
        open={quickOpenOpen}
        workspacePath={workspace.current.path}
        selectedRepositoryId={routeParams().get("repo")}
        onClose={() => setQuickOpenOpen(false)}
        onOpen={(file) => {
          const requestId = Date.now();
          setView("repositories");
          setOpenFileRequest({ ...file, requestId });
          updateRoute(
            {
              view: "repositories",
              repo: file.repositoryId,
              tab: "files",
              file: file.path,
              scope: "working",
              commit: null,
              terminal: null,
            },
            "push",
          );
        }}
      />
    </div>
  );
}
