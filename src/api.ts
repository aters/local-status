import type { CommitScope, LocalStatusBridge } from "./types";

function bridge(): LocalStatusBridge {
  if (!window.localStatus) {
    throw new Error("Local Status must run inside the desktop application.");
  }
  return window.localStatus;
}

export const api = {
  workspace: () => bridge().workspace.getCurrent(),
  chooseWorkspace: () => bridge().workspace.choose(),
  openWorkspace: (path: string) => bridge().workspace.openRecent(path),
  repositories: () => bridge().repositories.list(),
  changes: (repositoryId: string) => bridge().repositories.changes(repositoryId),
  commits: (repositoryId: string, scope: CommitScope) =>
    bridge().repositories.commits(repositoryId, scope),
  commit: (repositoryId: string, sha: string) =>
    bridge().repositories.commit(repositoryId, sha),
  files: (repositoryId: string) => bridge().repositories.files(repositoryId),
  comparison: (
    repositoryId: string,
    options: Parameters<LocalStatusBridge["repositories"]["comparison"]>[1],
  ) => bridge().repositories.comparison(repositoryId, options),
  fetch: (repositoryId: string) => bridge().repositories.fetch(repositoryId),
  fetchAll: () => bridge().repositories.fetchAll(),
  scripts: (repositoryId: string) => bridge().repositories.scripts(repositoryId),
  profiles: () => bridge().profiles.list(),
  saveProfile: (profile: Parameters<LocalStatusBridge["profiles"]["save"]>[0]) =>
    bridge().profiles.save(profile),
  removeProfile: (profileId: string) => bridge().profiles.remove(profileId),
  terminals: () => bridge().terminals.list(),
  createTerminal: (
    input: Parameters<LocalStatusBridge["terminals"]["create"]>[0],
  ) => bridge().terminals.create(input),
  writeTerminal: (sessionId: string, data: string) =>
    bridge().terminals.write(sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    bridge().terminals.resize(sessionId, cols, rows),
  stopTerminal: (sessionId: string) => bridge().terminals.stop(sessionId),
  restartTerminal: (sessionId: string) => bridge().terminals.restart(sessionId),
  renameTerminal: (sessionId: string, title: string) =>
    bridge().terminals.rename(sessionId, title),
  closeTerminal: (sessionId: string) => bridge().terminals.close(sessionId),
  listeners: () => bridge().system.listeners(),
  openLocalUrl: (url: string) => bridge().system.openLocalUrl(url),
};
