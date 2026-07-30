const { contextBridge, ipcRenderer } = require("electron");

const terminalListeners = new Map();
const shortcutListeners = new Map();
const appearanceListeners = new Map();

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("localStatus", {
  workspace: {
    getCurrent: () => invoke("workspace:get"),
    choose: () => invoke("workspace:choose"),
    openRecent: (path) => invoke("workspace:open", { path }),
  },
  repositories: {
    list: () => invoke("repositories:list"),
    changes: (repositoryId) => invoke("repositories:changes", { repositoryId }),
    commits: (repositoryId, scope) =>
      invoke("repositories:commits", { repositoryId, scope }),
    commit: (repositoryId, sha) =>
      invoke("repositories:commit", { repositoryId, sha }),
    files: (repositoryId) => invoke("repositories:files", { repositoryId }),
    workspaceFiles: () => invoke("repositories:workspace-files"),
    comparison: (repositoryId, options) =>
      invoke("repositories:comparison", { repositoryId, options }),
    fetch: (repositoryId) => invoke("repositories:fetch", { repositoryId }),
    fetchAll: () => invoke("repositories:fetch-all"),
    prepareCommit: (repositoryId) =>
      invoke("repositories:prepare-commit", { repositoryId }),
    createCommit: (repositoryId, input) =>
      invoke("repositories:create-commit", { repositoryId, input }),
    stage: (repositoryId, selection) =>
      invoke("repositories:stage", { repositoryId, selection }),
    unstage: (repositoryId, selection) =>
      invoke("repositories:unstage", { repositoryId, selection }),
    revert: (repositoryId, selection) =>
      invoke("repositories:revert", { repositoryId, selection }),
    stashes: (repositoryId) =>
      invoke("repositories:stashes", { repositoryId }),
    stash: (repositoryId, stashId) =>
      invoke("repositories:stash", { repositoryId, stashId }),
    createStash: (repositoryId, input) =>
      invoke("repositories:create-stash", { repositoryId, input }),
    applyStash: (repositoryId, stashId) =>
      invoke("repositories:apply-stash", { repositoryId, stashId }),
    popStash: (repositoryId, stashId) =>
      invoke("repositories:pop-stash", { repositoryId, stashId }),
    dropStash: (repositoryId, stashId) =>
      invoke("repositories:drop-stash", { repositoryId, stashId }),
    sync: (repositoryId) => invoke("repositories:sync", { repositoryId }),
    scripts: (repositoryId) => invoke("repositories:scripts", { repositoryId }),
    setFavourite: (groupId, favourite) =>
      invoke("repositories:set-favourite", { groupId, favourite }),
    setArchived: (repositoryId, archived) =>
      invoke("repositories:set-archived", { repositoryId, archived }),
    rename: (repositoryId, name) =>
      invoke("repositories:rename", { repositoryId, name }),
    branches: (repositoryId) =>
      invoke("repositories:branches", { repositoryId }),
    switchBranch: (repositoryId, targetRef) =>
      invoke("repositories:switch-branch", { repositoryId, targetRef }),
  },
  pullRequests: {
    list: () => invoke("pull-requests:list"),
    open: (url) => invoke("pull-requests:open", { url }),
  },
  preferences: {
    get: () => invoke("preferences:get"),
    setTheme: (theme) => invoke("preferences:set-theme", { theme }),
    setLiquidGlassAppearance: (appearance) =>
      invoke("preferences:set-liquid-glass-appearance", { appearance }),
  },
  appearance: {
    get: () => invoke("appearance:get"),
    onChange: (callback) => {
      if (typeof callback !== "function" || appearanceListeners.has(callback)) return;
      const listener = (_event, appearance) => callback(appearance);
      appearanceListeners.set(callback, listener);
      ipcRenderer.on("appearance:changed", listener);
    },
    offChange: (callback) => {
      const listener = appearanceListeners.get(callback);
      if (!listener) return;
      ipcRenderer.removeListener("appearance:changed", listener);
      appearanceListeners.delete(callback);
    },
  },
  shortcuts: {
    onRequest: (callback) => {
      if (typeof callback !== "function" || shortcutListeners.has(callback)) return;
      const listener = (_event, shortcut) => {
        if (shortcut === "quick-open" || shortcut === "find") callback(shortcut);
      };
      shortcutListeners.set(callback, listener);
      ipcRenderer.on("application:shortcut", listener);
    },
    offRequest: (callback) => {
      const listener = shortcutListeners.get(callback);
      if (!listener) return;
      ipcRenderer.removeListener("application:shortcut", listener);
      shortcutListeners.delete(callback);
    },
  },
  ai: {
    status: () => invoke("ai:status"),
    setPreferences: (provider, model) =>
      invoke("ai:set-preferences", { provider, model }),
    chooseExecutable: (provider) =>
      invoke("ai:choose-executable", { provider }),
    acceptDisclosure: (provider) =>
      invoke("ai:accept-disclosure", { provider }),
    generateCommitMessage: (input) =>
      invoke("ai:generate-commit-message", input),
    cancelGeneration: (requestId) =>
      invoke("ai:cancel-generation", { requestId }),
  },
  profiles: {
    list: () => invoke("profiles:list"),
    save: (profile) => invoke("profiles:save", { profile }),
    remove: (profileId) => invoke("profiles:remove", { profileId }),
  },
  terminals: {
    list: () => invoke("terminals:list"),
    create: (input) => invoke("terminals:create", input),
    write: (sessionId, data) => invoke("terminals:write", { sessionId, data }),
    resize: (sessionId, cols, rows) =>
      invoke("terminals:resize", { sessionId, cols, rows }),
    stop: (sessionId) => invoke("terminals:stop", { sessionId }),
    restart: (sessionId) => invoke("terminals:restart", { sessionId }),
    rename: (sessionId, title) => invoke("terminals:rename", { sessionId, title }),
    close: (sessionId) => invoke("terminals:close", { sessionId }),
    onEvent: (callback) => {
      if (typeof callback !== "function" || terminalListeners.has(callback)) return;
      const listener = (_event, payload) => callback(payload);
      terminalListeners.set(callback, listener);
      ipcRenderer.on("terminals:event", listener);
    },
    offEvent: (callback) => {
      const listener = terminalListeners.get(callback);
      if (!listener) return;
      ipcRenderer.removeListener("terminals:event", listener);
      terminalListeners.delete(callback);
    },
  },
  system: {
    listeners: () => invoke("system:listeners"),
    openLocalUrl: (url) => invoke("system:open-local-url", { url }),
  },
});
