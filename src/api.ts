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
  workspaceFiles: () => bridge().repositories.workspaceFiles(),
  comparison: (
    repositoryId: string,
    options: Parameters<LocalStatusBridge["repositories"]["comparison"]>[1],
  ) => bridge().repositories.comparison(repositoryId, options),
  fetch: (repositoryId: string) => bridge().repositories.fetch(repositoryId),
  fetchAll: () => bridge().repositories.fetchAll(),
  prepareCommit: (repositoryId: string) =>
    bridge().repositories.prepareCommit(repositoryId),
  createCommit: (
    repositoryId: string,
    input: Parameters<LocalStatusBridge["repositories"]["createCommit"]>[1],
  ) => bridge().repositories.createCommit(repositoryId, input),
  stage: (
    repositoryId: string,
    selection: Parameters<LocalStatusBridge["repositories"]["stage"]>[1],
  ) => bridge().repositories.stage(repositoryId, selection),
  unstage: (
    repositoryId: string,
    selection: Parameters<LocalStatusBridge["repositories"]["unstage"]>[1],
  ) => bridge().repositories.unstage(repositoryId, selection),
  revert: (
    repositoryId: string,
    selection: Parameters<LocalStatusBridge["repositories"]["revert"]>[1],
  ) => bridge().repositories.revert(repositoryId, selection),
  stashes: (repositoryId: string) =>
    bridge().repositories.stashes(repositoryId),
  stash: (repositoryId: string, stashId: string) =>
    bridge().repositories.stash(repositoryId, stashId),
  createStash: (
    repositoryId: string,
    input: Parameters<LocalStatusBridge["repositories"]["createStash"]>[1],
  ) => bridge().repositories.createStash(repositoryId, input),
  applyStash: (repositoryId: string, stashId: string) =>
    bridge().repositories.applyStash(repositoryId, stashId),
  popStash: (repositoryId: string, stashId: string) =>
    bridge().repositories.popStash(repositoryId, stashId),
  dropStash: (repositoryId: string, stashId: string) =>
    bridge().repositories.dropStash(repositoryId, stashId),
  sync: (repositoryId: string) => bridge().repositories.sync(repositoryId),
  scripts: (repositoryId: string) => bridge().repositories.scripts(repositoryId),
  setFavourite: (groupId: string, favourite: boolean) =>
    bridge().repositories.setFavourite(groupId, favourite),
  setArchived: (groupId: string, archived: boolean) =>
    bridge().repositories.setArchived(groupId, archived),
  branches: (repositoryId: string) =>
    bridge().repositories.branches(repositoryId),
  switchBranch: (repositoryId: string, targetRef: string) =>
    bridge().repositories.switchBranch(repositoryId, targetRef),
  pullRequests: () => bridge().pullRequests.list(),
  openPullRequest: (url: string) => bridge().pullRequests.open(url),
  preferences: () =>
    bridge().preferences?.get() ??
    Promise.resolve({
      theme:
        window.localStorage.getItem("local-status:theme") === "dark" ||
        window.localStorage.getItem("local-status:theme") === "light"
          ? window.localStorage.getItem("local-status:theme") as "dark" | "light"
          : "green",
    }),
  setTheme: (theme: Parameters<LocalStatusBridge["preferences"]["setTheme"]>[0]) =>
    bridge().preferences?.setTheme(theme) ?? Promise.resolve({ theme }),
  aiStatus: () => bridge().ai.status(),
  setAiPreferences: (
    provider: Parameters<LocalStatusBridge["ai"]["setPreferences"]>[0],
    model: string,
  ) => bridge().ai.setPreferences(provider, model),
  chooseAiExecutable: (
    provider: Parameters<LocalStatusBridge["ai"]["chooseExecutable"]>[0],
  ) => bridge().ai.chooseExecutable(provider),
  acceptAiDisclosure: (
    provider: Parameters<LocalStatusBridge["ai"]["acceptDisclosure"]>[0],
  ) => bridge().ai.acceptDisclosure(provider),
  generateCommitMessage: (
    input: Parameters<LocalStatusBridge["ai"]["generateCommitMessage"]>[0],
  ) => bridge().ai.generateCommitMessage(input),
  cancelCommitMessageGeneration: (requestId: string) =>
    bridge().ai.cancelGeneration(requestId),
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
