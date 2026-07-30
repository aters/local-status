import {
  FolderOpen,
  GitBranch,
  Settings,
  HardDrive,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { RepositoryWorkspace } from "./components/RepositoryWorkspace";
import { ServicesView } from "./components/ServicesView";
import { SettingsView } from "./components/SettingsView";
import { AppTooltip } from "./components/AppTooltip";
import { routeParams, updateRoute } from "./route";
import type {
  AiProvider,
  AiTerminalAction,
  RepositoriesResponse,
  TerminalKind,
  TerminalSession,
  Theme,
  WorkspaceState,
} from "./types";

type AppView = "repositories" | "services" | "settings";

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
  return value === "services" || value === "settings" ? value : "repositories";
}

function shellArgument(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
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
  onChoose: () => Promise<void>;
  onOpenRecent: (path: string) => Promise<void>;
}) {
  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <ProductLogo className="onboarding-mark" />
        <p className="eyebrow">Local-first development workspace</p>
        <h1>Every repository, one clear view.</h1>
        <p className="onboarding-copy">
          Choose a folder containing your Git repositories. Local Status will show
          working changes, commits, file trees and interactive terminals without
          sending anything off this machine.
        </p>
        {error && <div className="onboarding-error">{error}</div>}
        <button
          className="choose-workspace-button"
          type="button"
          disabled={busy}
          onClick={() => void onChoose()}
        >
          <FolderOpen size={18} />
          {busy ? "Opening…" : "Choose workspace"}
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
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("local-status:theme");
    const initial = saved === "dark" || saved === "light" ? saved : "green";
    document.documentElement.dataset.theme = initial;
    return initial;
  });
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [repositories, setRepositories] = useState<RepositoriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => routeParams().get("terminal"),
  );
  const workspacePath = workspace?.current?.path ?? null;

  const refreshRepositories = useCallback(async () => {
    setError(null);
    try {
      setRepositories(await api.repositories());
    } catch (caught) {
      setError(
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
        setError(
          caught instanceof Error ? caught.message : "Could not load workspace settings.",
        );
        setWorkspace({ current: null, recent: [] });
        setLoading(false);
      });
  }, [applyWorkspaceState]);

  useEffect(() => {
    void api
      .preferences()
      .then((preferences) => setTheme(preferences.theme))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme =
      theme === "light" ? "light" : "dark";
    window.localStorage.setItem("local-status:theme", theme);
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

  async function chooseWorkspace() {
    setWorkspaceBusy(true);
    setError(null);
    try {
      const next = await api.chooseWorkspace();
      if (!next) return;
      if (next.current?.path === workspacePath) {
        setWorkspace(next);
        return;
      }
      await applyWorkspaceState(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that workspace.");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function openRecent(path: string) {
    setWorkspaceBusy(true);
    setError(null);
    try {
      const next = await api.openWorkspace(path);
      if (!next) return;
      if (next.current?.path === workspacePath) {
        setWorkspace(next);
        return;
      }
      await applyWorkspaceState(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That workspace is no longer available.",
      );
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
        error={error}
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
            <span>Private desktop workspace</span>
          </div>
        </div>
        <nav className="app-nav" aria-label="Workspace sections">
          <button
            type="button"
            className={view === "repositories" ? "is-active" : ""}
            onClick={() => selectView("repositories")}
          >
            <GitBranch size={15} />
            <span>Repositories</span>
          </button>
          <button
            type="button"
            className={view === "services" ? "is-active" : ""}
            onClick={() => selectView("services")}
          >
            <ServerCog size={15} />
            <span>Services</span>
          </button>
        </nav>
        <div className="app-header__actions">
          <button
            className="workspace-switcher"
            type="button"
            onClick={() => void chooseWorkspace()}
            disabled={workspaceBusy}
            title={workspace.current.path}
          >
            <FolderOpen size={14} />
            <span>{workspace.current.name}</span>
            <small>Change</small>
          </button>
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
          error={error}
          onRefresh={refreshRepositories}
          onStartTerminal={startTerminal}
          onStartAiTerminal={startAiTerminal}
          theme={theme}
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
        />
      ) : (
        <SettingsView theme={theme} onThemeChange={changeTheme} />
      )}
    </div>
  );
}
