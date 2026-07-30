import {
  Activity,
  CircleStop,
  Command,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  SearchCode,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  Listener,
  RepositoryScript,
  RepositorySummary,
  ServiceProfile,
  TerminalEvent,
  TerminalKind,
  TerminalSession,
} from "../types";
import { TerminalPane } from "./TerminalPane";

function elapsed(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h`;
}

function groupedSessions(sessions: TerminalSession[]) {
  const groups = new Map<string, TerminalSession[]>();
  for (const session of sessions) {
    groups.set(session.repositoryId, [
      ...(groups.get(session.repositoryId) ?? []),
      session,
    ]);
  }
  return [...groups.entries()];
}

export function ServicesView({
  repositories,
  activeSessionId,
  onActiveSessionChange,
  onStartTerminal,
  findRequest,
}: {
  repositories: RepositorySummary[];
  activeSessionId: string | null;
  onActiveSessionChange: (sessionId: string | null) => void;
  onStartTerminal: (
    repositoryId: string,
    kind: TerminalKind,
    option?: string,
  ) => Promise<void>;
  findRequest: number;
}) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [profiles, setProfiles] = useState<ServiceProfile[]>([]);
  const [listeners, setListeners] = useState<Listener[]>([]);
  const [selectedRepository, setSelectedRepository] = useState(
    () => repositories[0]?.id ?? "",
  );
  const [scripts, setScripts] = useState<RepositoryScript[]>([]);
  const [scriptName, setScriptName] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileExecutable, setProfileExecutable] = useState("");
  const [profileArgs, setProfileArgs] = useState("");
  const [profileCwd, setProfileCwd] = useState(".");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextSessions, nextProfiles] = await Promise.all([
      api.terminals(),
      api.profiles(),
    ]);
    setSessions(nextSessions);
    setProfiles(nextProfiles);
    if (!activeSessionId && nextSessions[0]) {
      onActiveSessionChange(nextSessions[0].id);
    }
  }, [activeSessionId, onActiveSessionChange]);

  const refreshListeners = useCallback(async () => {
    try {
      setListeners((await api.listeners()).listeners);
    } catch {
      setListeners([]);
    }
  }, []);

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Could not load services."),
    );
    void refreshListeners();
    const interval = window.setInterval(() => void refreshListeners(), 15_000);
    const onEvent = (event: TerminalEvent) => {
      setSessions((current) => {
        if (event.type === "removed") {
          return current.filter((session) => session.id !== event.sessionId);
        }
        if (event.type === "output") {
          return current.map((session) =>
            session.id === event.sessionId
              ? { ...session, truncated: event.truncated }
              : session,
          );
        }
        const exists = current.some((session) => session.id === event.session.id);
        return exists
          ? current.map((session) =>
              session.id === event.session.id ? event.session : session,
            )
          : [event.session, ...current];
      });
    };
    window.localStatus.terminals.onEvent(onEvent);
    return () => {
      window.clearInterval(interval);
      window.localStatus.terminals.offEvent(onEvent);
    };
  }, [load, refreshListeners]);

  useEffect(() => {
    if (!selectedRepository && repositories[0]) {
      setSelectedRepository(repositories[0].id);
    }
  }, [repositories, selectedRepository]);

  useEffect(() => {
    if (!selectedRepository) {
      setScripts([]);
      return;
    }
    void api
      .scripts(selectedRepository)
      .then((response) => {
        setScripts(response.scripts);
        setScriptName(response.scripts[0]?.name ?? "");
      })
      .catch(() => setScripts([]));
  }, [selectedRepository]);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const running = sessions.filter((session) => session.status === "running").length;
  const grouped = useMemo(() => groupedSessions(sessions), [sessions]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The terminal action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    await run(async () => {
      setProfiles(
        await api.saveProfile({
          repositoryId: selectedRepository,
          name: profileName,
          executable: profileExecutable,
          args: profileArgs
            .split(/\s+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
          cwdRelative: profileCwd || ".",
        }),
      );
      setProfileName("");
      setProfileExecutable("");
      setProfileArgs("");
      setProfileCwd(".");
      setProfileOpen(false);
    });
  }

  return (
    <main className="services-workspace">
      <section className="services-toolbar">
        <div>
          <p className="eyebrow">Interactive local processes</p>
          <h1>Services & terminals</h1>
          <span>
            {running} running · {sessions.length} sessions · {listeners.length} listeners
          </span>
        </div>
        <div className="service-launcher">
          <select
            value={selectedRepository}
            onChange={(event) => setSelectedRepository(event.target.value)}
            aria-label="Repository for new service"
          >
            {repositories.map((repository) => (
              <option value={repository.id} key={repository.id}>
                {repository.id}
              </option>
            ))}
          </select>
          <button
            className="secondary-button"
            type="button"
            disabled={!selectedRepository || busy}
            onClick={() =>
              void run(() => onStartTerminal(selectedRepository, "shell"))
            }
          >
            <SquareTerminal size={15} /> New terminal
          </button>
          <select
            value={scriptName}
            onChange={(event) => setScriptName(event.target.value)}
            aria-label="Package script"
            disabled={!scripts.length}
          >
            {scripts.length ? (
              scripts.map((script) => (
                <option value={script.name} key={script.name}>
                  {script.runner} · {script.name}
                </option>
              ))
            ) : (
              <option>No package scripts</option>
            )}
          </select>
          <button
            className="primary-button"
            type="button"
            disabled={!selectedRepository || !scriptName || busy}
            onClick={() =>
              void run(() =>
                onStartTerminal(selectedRepository, "script", scriptName),
              )
            }
          >
            <Play size={14} /> Run script
          </button>
          <button
            className="icon-button"
            type="button"
            title="New service profile"
            aria-label="New service profile"
            onClick={() => setProfileOpen((current) => !current)}
          >
            <Plus size={17} />
          </button>
        </div>
      </section>

      {error && (
        <div className="global-alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {profileOpen && (
        <section className="profile-editor">
          <div>
            <p className="eyebrow">Saved locally for this workspace</p>
            <h2>New service profile</h2>
          </div>
          <label>
            Name
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="API development server"
            />
          </label>
          <label>
            Executable
            <input
              value={profileExecutable}
              onChange={(event) => setProfileExecutable(event.target.value)}
              placeholder="python3"
            />
          </label>
          <label>
            Arguments
            <input
              value={profileArgs}
              onChange={(event) => setProfileArgs(event.target.value)}
              placeholder="-m uvicorn app:api --reload"
            />
          </label>
          <label>
            Working folder
            <input
              value={profileCwd}
              onChange={(event) => setProfileCwd(event.target.value)}
              placeholder="."
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={!profileName || !profileExecutable || !selectedRepository || busy}
            onClick={() => void saveProfile()}
          >
            <Save size={14} /> Save profile
          </button>
        </section>
      )}

      <section className="service-layout">
        <aside className="session-panel">
          <div className="session-panel__header">
            <div>
              <span className="panel-kicker">Managed by Local Status</span>
              <strong>Sessions</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Refresh listeners"
              onClick={() => void refreshListeners()}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="session-list">
            {grouped.map(([repositoryId, entries]) => (
              <div className="session-group" key={repositoryId}>
                <span>{repositoryId}</span>
                {entries.map((session) => (
                  <button
                    type="button"
                    className={session.id === activeSession?.id ? "is-active" : ""}
                    key={session.id}
                    onClick={() => onActiveSessionChange(session.id)}
                  >
                    <span className={`session-status is-${session.status}`} />
                    <span>
                      <strong>{session.title}</strong>
                      <small>
                        {session.status} · {elapsed(session.startedAt)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!sessions.length && (
              <div className="service-empty">
                <SquareTerminal size={23} />
                <strong>No terminal sessions</strong>
                <span>Start a shell or package script above.</span>
              </div>
            )}
          </div>
          {profiles.length > 0 && (
            <div className="profile-list">
              <span className="panel-kicker">Saved profiles</span>
              {profiles.map((profile) => (
                <div key={profile.id}>
                  <Command size={14} />
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{profile.repositoryId}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Run ${profile.name}`}
                    title="Run profile"
                    onClick={() =>
                      void run(() =>
                        onStartTerminal(profile.repositoryId, "profile", profile.id),
                      )
                    }
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${profile.name}`}
                    title="Delete profile"
                    onClick={() =>
                      void run(async () =>
                        setProfiles(await api.removeProfile(profile.id)),
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="terminal-stage">
          {activeSession ? (
            <>
              <header className="terminal-titlebar">
                <div>
                  <span className={`session-status is-${activeSession.status}`} />
                  <div>
                    <strong>{activeSession.title}</strong>
                    <small>
                      {activeSession.repositoryId} · {activeSession.kind}
                    </small>
                  </div>
                </div>
                <div>
                  {activeSession.status === "running" ||
                  activeSession.status === "stopping" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void run(() => api.stopTerminal(activeSession.id))
                      }
                      title="Stop terminal"
                    >
                      <CircleStop size={14} /> Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          const next = await api.restartTerminal(activeSession.id);
                          onActiveSessionChange(next.id);
                        })
                      }
                      title="Restart terminal"
                    >
                      <RotateCw size={14} /> Restart
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const title = window.prompt("Terminal name", activeSession.title);
                      if (title) {
                        void run(() => api.renameTerminal(activeSession.id, title));
                      }
                    }}
                    title="Rename terminal"
                  >
                    <Command size={14} /> Rename
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await api.closeTerminal(activeSession.id);
                        onActiveSessionChange(null);
                      })
                    }
                    title="Close terminal"
                  >
                    <X size={14} /> Close
                  </button>
                </div>
              </header>
              <TerminalPane session={activeSession} findRequest={findRequest} />
            </>
          ) : (
            <div className="terminal-welcome">
              <span>
                <SearchCode size={28} />
              </span>
              <p className="eyebrow">Repository-aware terminals</p>
              <h2>Run your stack without losing context.</h2>
              <p>
                Open a shell, launch a package script, or create a reusable service
                profile. Every process remains on this machine.
              </p>
            </div>
          )}
        </section>

        <aside className="listener-sidebar">
          <header>
            <Activity size={15} />
            <div>
              <strong>System listeners</strong>
              <span>Read-only macOS snapshot</span>
            </div>
          </header>
          <div>
            {listeners.map((listener) => (
              <div
                className="system-listener"
                key={`${listener.pid}:${listener.address}`}
              >
                <span>
                  <strong>{listener.process}</strong>
                  <small>{listener.pid ? `PID ${listener.pid}` : "Process"}</small>
                </span>
                <code>:{listener.port}</code>
              </div>
            ))}
            {!listeners.length && (
              <div className="service-empty">
                <span>No TCP listeners detected.</span>
              </div>
            )}
          </div>
          <p>
            Listening means a process owns a port. It does not prove application
            health.
          </p>
        </aside>
      </section>
    </main>
  );
}
