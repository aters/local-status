import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  protocol,
  shell,
} from "electron";
import pty from "node-pty";
import {
  commitMessageContext,
  commitDetails,
  comparisonContents,
  createCommit,
  applyRepositoryStash,
  discoverRepositories,
  fetchAll,
  fetchOne,
  getRepository,
  getWorkspaceRoot,
  listRepositorySummaries,
  localListeners,
  repositoryChanges,
  repositoryBranches,
  repositoryCommits,
  repositoryFiles,
  repositoryStashes,
  prepareCommit,
  revertChanges,
  stageChanges,
  syncRepository,
  switchRepositoryBranch,
  unstageChanges,
} from "../server/git-service.mjs";
import { AiRunner } from "./codex-runner.mjs";
import { discoverScripts } from "./script-discovery.mjs";
import { applicationMenuTemplate } from "./application-menu.mjs";
import {
  GithubService,
  validatePullRequestUrl,
} from "./github-service.mjs";
import { SettingsStore } from "./settings-store.mjs";
import { TerminalManager } from "./terminal-manager.mjs";
import { WorkspaceManager } from "./workspace-manager.mjs";

const appDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererRoot = join(appDirectory, "dist");
const preloadPath = join(appDirectory, "electron", "preload.cjs");
const appIconPath = join(appDirectory, "assets", "local-status-icon.png");
const commitMessageSchemaPath = join(
  appDirectory,
  "electron",
  "commit-message.schema.json",
);
const developmentUrl = process.env.LOCAL_STATUS_DEV_URL || null;

// Keep Electron's internal app identity aligned with the branded runtime bundle.
app.setName("Local Status");

if (process.env.LOCAL_STATUS_TEST_USER_DATA) {
  app.setPath("userData", process.env.LOCAL_STATUS_TEST_USER_DATA);
}
if (process.env.LOCAL_STATUS_E2E_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.LOCAL_STATUS_E2E_PORT);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-status",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

let mainWindow = null;
let settingsStore;
let workspaceManager;
let terminalManager;
let aiRunner;
let githubService;
let quitting = false;

function configureApplicationIdentity() {
  const appIcon = nativeImage.createFromPath(appIconPath);
  if (!appIcon.isEmpty() && process.platform === "darwin") {
    app.dock?.setIcon(appIcon);
  }

  app.setAboutPanelOptions({
    applicationName: "Local Status",
    applicationVersion: app.getVersion(),
    copyright: "MIT licensed",
    credits: "A local desktop workspace for multiple Git repositories.",
  });

  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(applicationMenuTemplate()),
    );
  }
}

function assertSender(event) {
  const source = event.senderFrame?.url || "";
  const allowed = developmentUrl
    ? source.startsWith(developmentUrl)
    : source.startsWith("local-status://app/");
  if (!allowed || event.sender !== mainWindow?.webContents) {
    throw new Error("The request did not come from the Local Status window.");
  }
}

function requireObject(value, label = "request") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requireString(value, label, maxLength = 1_024) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, payload) => {
    assertSender(event);
    return callback(payload);
  });
}

async function confirmStopForWorkspaceChange() {
  if (!terminalManager.hasRunningSessions()) return true;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Stop running terminals?",
    message: "Changing workspace will stop every running terminal session.",
    detail: "Local Status will not leave repository processes running in the background.",
    buttons: ["Stop terminals and change", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  if (result.response !== 0) return false;
  await terminalManager.stopAll();
  return true;
}

async function repositoriesWithPreferences() {
  const archived = new Set(
    getWorkspaceRoot()
      ? settingsStore.archivedGroupsFor(getWorkspaceRoot())
      : [],
  );
  const response = await listRepositorySummaries({
    archivedGroupIds: archived,
  });
  const favourites = new Set(
    getWorkspaceRoot()
      ? settingsStore.favouriteGroupsFor(getWorkspaceRoot())
      : [],
  );
  return {
    ...response,
    repositories: response.repositories.map((repository) => ({
      ...repository,
      favourite: favourites.has(repository.groupId),
    })),
  };
}

async function requireActiveRepository(repositoryId) {
  const repository = await getRepository(repositoryId);
  const archived = new Set(
    settingsStore.archivedGroupsFor(getWorkspaceRoot()),
  );
  if (archived.has(repository.groupId)) {
    throw new Error("Restore this repository before running Git operations.");
  }
  return repository;
}

async function validatedWorkingDirectory(repositoryPath, relativePath) {
  const value = relativePath || ".";
  if (isAbsolute(value) || value.includes("\0")) {
    throw new Error("The service working directory is invalid.");
  }
  const directory = resolve(repositoryPath, value);
  const fromRoot = relative(repositoryPath, directory);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("The service working directory must stay inside its repository.");
  }
  if (!(await stat(directory)).isDirectory()) {
    throw new Error("The service working directory does not exist.");
  }
  return directory;
}

function validateProfileInput(input) {
  const profile = requireObject(input, "service profile");
  const args = Array.isArray(profile.args)
    ? profile.args.map((entry) => requireString(entry, "argument", 2_048))
    : [];
  if (args.length > 50) throw new Error("A service profile can have at most 50 arguments.");
  return {
    id:
      typeof profile.id === "string" && /^[0-9a-f-]{20,}$/i.test(profile.id)
        ? profile.id
        : randomUUID(),
    repositoryId: requireString(profile.repositoryId, "repository", 255),
    name: requireString(profile.name, "profile name", 80),
    executable: requireString(profile.executable, "executable", 512),
    args,
    cwdRelative:
      typeof profile.cwdRelative === "string" && profile.cwdRelative.trim()
        ? profile.cwdRelative.trim()
        : ".",
  };
}

function validateChangeSelection(input) {
  const request = requireObject(input, "change selection");
  const scope = requireString(request.scope, "change scope", 20);
  if (!["conflict", "staged", "working", "untracked", "unstaged"].includes(scope)) {
    throw new Error("Invalid change scope.");
  }
  return {
    scope,
    path:
      request.path === undefined || request.path === null
        ? null
        : requireString(request.path, "file path", 8_192),
  };
}

function validateCommitInput(input) {
  const request = requireObject(input, "commit");
  const message = requireString(request.message, "commit message", 20_000);
  const snapshotId = requireString(
    request.snapshotId,
    "staged snapshot",
    64,
  );
  if (!/^[0-9a-f]{64}$/i.test(snapshotId) || message.includes("\0")) {
    throw new Error("Invalid commit request.");
  }
  return { message, snapshotId };
}

function validateAiGeneration(input) {
  const request = requireObject(input, "AI generation");
  const snapshotId = requireString(
    request.snapshotId,
    "staged snapshot",
    64,
  );
  const requestId = requireString(request.requestId, "generation request", 100);
  if (
    !/^[0-9a-f]{64}$/i.test(snapshotId) ||
    !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)
  ) {
    throw new Error("Invalid AI generation request.");
  }
  return {
    repositoryId: requireString(request.repositoryId, "repository", 255),
    snapshotId,
    requestId,
  };
}

async function confirmRevert(selection) {
  const isUnstaged = selection.scope === "unstaged";
  const isUntracked = selection.scope === "untracked";
  const target = selection.path
    ? `“${selection.path}”`
    : isUnstaged
      ? "all unstaged changes"
      : `all ${selection.scope === "untracked" ? "untracked files" : "working tree changes"}`;
  const title = isUntracked
    ? "Delete untracked work?"
    : isUnstaged
      ? "Discard all unstaged changes?"
      : "Discard local changes?";
  const detail = isUnstaged
    ? "Tracked edits will be replaced by the index version, and untracked files will be permanently deleted. This cannot be undone by Git."
    : isUntracked
      ? "Untracked files will be permanently deleted. This cannot be undone by Git."
      : "The selected working tree edits will be replaced by the index version.";
  const primaryAction = isUntracked
    ? "Delete"
    : isUnstaged
      ? "Discard all"
      : "Discard";
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title,
    message: `${isUntracked ? "Delete" : "Discard"} ${target}?`,
    detail,
    buttons: [primaryAction, "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0;
}

async function terminalSpec(input) {
  const request = requireObject(input);
  const repositoryId = requireString(request.repositoryId, "repository", 255);
  const repository = await getRepository(repositoryId);
  const kind = ["shell", "script", "profile"].includes(request.kind)
    ? request.kind
    : "shell";

  if (kind === "script") {
    const scriptName = requireString(request.scriptName, "script", 255);
    const script = (await discoverScripts(repository.path)).find(
      (entry) => entry.name === scriptName,
    );
    if (!script) throw new Error("The selected package script no longer exists.");
    return {
      repositoryId,
      kind,
      title: `${repositoryId} · ${scriptName}`,
      executable: script.command,
      args: script.args,
      cwd: repository.path,
    };
  }

  if (kind === "profile") {
    const profileId = requireString(request.profileId, "profile", 100);
    const profile = settingsStore
      .profilesFor(getWorkspaceRoot())
      .find((entry) => entry.id === profileId && entry.repositoryId === repositoryId);
    if (!profile) throw new Error("The selected service profile no longer exists.");
    return {
      repositoryId,
      kind,
      title: profile.name,
      executable: profile.executable,
      args: profile.args,
      cwd: await validatedWorkingDirectory(repository.path, profile.cwdRelative),
    };
  }

  return {
    repositoryId,
    kind: "shell",
    title: `${repositoryId} · Terminal`,
    executable: process.env.SHELL || "/bin/zsh",
    args: ["-l"],
    cwd: repository.path,
  };
}

function registerIpc() {
  handle("workspace:get", () => workspaceManager.state());
  handle("workspace:choose", async () => {
    if (!(await confirmStopForWorkspaceChange())) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a multi-repository workspace",
      buttonLabel: "Use workspace",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    aiRunner.stopAll();
    return workspaceManager.open(result.filePaths[0]);
  });
  handle("workspace:open", async (payload) => {
    if (!(await confirmStopForWorkspaceChange())) return null;
    aiRunner.stopAll();
    return workspaceManager.open(
      requireString(requireObject(payload).path, "workspace path"),
    );
  });

  handle("repositories:list", () => repositoriesWithPreferences());
  handle("repositories:set-favourite", async (payload) => {
    const request = requireObject(payload);
    const groupId = requireString(request.groupId, "repository group", 100);
    const response = await listRepositorySummaries({
      archivedGroupIds: settingsStore.archivedGroupsFor(getWorkspaceRoot()),
    });
    if (!response.repositories.some((repository) => repository.groupId === groupId)) {
      throw new Error("Repository group not found.");
    }
    await settingsStore.setFavouriteGroup(
      getWorkspaceRoot(),
      groupId,
      request.favourite === true,
    );
    return repositoriesWithPreferences();
  });
  handle("repositories:set-archived", async (payload) => {
    const request = requireObject(payload);
    const groupId = requireString(request.groupId, "repository group", 100);
    const archivedGroups = settingsStore.archivedGroupsFor(getWorkspaceRoot());
    const response = await listRepositorySummaries({
      archivedGroupIds: archivedGroups,
    });
    if (!response.repositories.some((repository) => repository.groupId === groupId)) {
      throw new Error("Repository group not found.");
    }
    await settingsStore.setArchivedGroup(
      getWorkspaceRoot(),
      groupId,
      request.archived === true,
    );
    return repositoriesWithPreferences();
  });
  handle("repositories:changes", (payload) =>
    repositoryChanges(requireString(requireObject(payload).repositoryId, "repository")),
  );
  handle("repositories:commits", (payload) => {
    const request = requireObject(payload);
    const scope = ["local", "incoming", "outgoing"].includes(request.scope)
      ? request.scope
      : "local";
    return repositoryCommits(
      requireString(request.repositoryId, "repository"),
      scope,
    );
  });
  handle("repositories:commit", (payload) => {
    const request = requireObject(payload);
    return commitDetails(
      requireString(request.repositoryId, "repository"),
      requireString(request.sha, "commit"),
    );
  });
  handle("repositories:files", (payload) =>
    repositoryFiles(requireString(requireObject(payload).repositoryId, "repository")),
  );
  handle("repositories:comparison", (payload) => {
    const request = requireObject(payload);
    return comparisonContents(
      requireString(request.repositoryId, "repository"),
      requireObject(request.options, "comparison"),
    );
  });
  handle("repositories:fetch", async (payload) => {
    const repositoryId = requireString(
      requireObject(payload).repositoryId,
      "repository",
    );
    await requireActiveRepository(repositoryId);
    return fetchOne(repositoryId);
  });
  handle("repositories:fetch-all", () =>
    fetchAll({
      excludeGroupIds: settingsStore.archivedGroupsFor(getWorkspaceRoot()),
    }),
  );
  handle("repositories:prepare-commit", (payload) =>
    prepareCommit(
      requireString(requireObject(payload).repositoryId, "repository"),
    ),
  );
  handle("repositories:create-commit", (payload) => {
    const request = requireObject(payload);
    return createCommit(
      requireString(request.repositoryId, "repository"),
      validateCommitInput(request.input),
    );
  });
  handle("repositories:stage", (payload) => {
    const request = requireObject(payload);
    return stageChanges(
      requireString(request.repositoryId, "repository"),
      validateChangeSelection(request.selection),
    );
  });
  handle("repositories:unstage", (payload) => {
    const request = requireObject(payload);
    return unstageChanges(
      requireString(request.repositoryId, "repository"),
      validateChangeSelection(request.selection),
    );
  });
  handle("repositories:revert", async (payload) => {
    const request = requireObject(payload);
    const repositoryId = requireString(request.repositoryId, "repository");
    const selection = validateChangeSelection(request.selection);
    if (!(await confirmRevert(selection))) {
      return { ...(await repositoryChanges(repositoryId)), cancelled: true };
    }
    return revertChanges(repositoryId, selection);
  });
  handle("repositories:sync", async (payload) => {
    const repositoryId = requireString(
      requireObject(payload).repositoryId,
      "repository",
    );
    await requireActiveRepository(repositoryId);
    return syncRepository(repositoryId);
  });
  handle("repositories:scripts", async (payload) => {
    const repositoryId = requireString(
      requireObject(payload).repositoryId,
      "repository",
    );
    const repository = await getRepository(repositoryId);
    return { repositoryId, scripts: await discoverScripts(repository.path) };
  });
  handle("repositories:branches", (payload) =>
    repositoryBranches(
      requireString(requireObject(payload).repositoryId, "repository"),
    ),
  );
  handle("repositories:switch-branch", async (payload) => {
    const request = requireObject(payload);
    const repositoryId = requireString(request.repositoryId, "repository");
    const targetRef = requireString(request.targetRef, "branch", 1_024);
    const initial = await switchRepositoryBranch(repositoryId, targetRef);
    if (!initial.requiresStash) return initial;
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Stash changes before switching?",
      message: "This checkout has local changes.",
      detail:
        "Local Status can stash tracked and untracked files, switch branches, and keep the stash for you to restore later.",
      buttons: ["Stash and switch", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) {
      return {
        repositoryId,
        requiresStash: false,
        cancelled: true,
        stashed: null,
      };
    }
    return switchRepositoryBranch(repositoryId, targetRef, {
      stashChanges: true,
    });
  });
  handle("repositories:stashes", (payload) =>
    repositoryStashes(
      requireString(requireObject(payload).repositoryId, "repository"),
    ),
  );
  handle("repositories:stash-action", (payload) => {
    const request = requireObject(payload);
    return applyRepositoryStash(
      requireString(request.repositoryId, "repository"),
      requireString(request.stashRef, "stash", 100),
      requireString(request.mode, "stash action", 20),
    );
  });

  handle("pull-requests:list", async () => {
    const repositories = await discoverRepositories({ refresh: true });
    return githubService.list([...repositories.values()], {
      excludeGroupIds: settingsStore.archivedGroupsFor(getWorkspaceRoot()),
    });
  });
  handle("pull-requests:open", async (payload) => {
    const url = validatePullRequestUrl(
      requireString(requireObject(payload).url, "pull request URL", 2_048),
    );
    await shell.openExternal(url);
  });

  handle("preferences:get", () => settingsStore.preferences());
  handle("preferences:set-theme", (payload) =>
    settingsStore.setTheme(
      requireString(requireObject(payload).theme, "theme", 20),
    ),
  );

  handle("ai:status", () => aiRunner.status());
  handle("ai:set-preferences", (payload) => {
    const request = requireObject(payload, "AI preferences");
    return aiRunner.setPreferences(
      requireString(request.provider, "AI provider", 20),
      requireString(request.model, "AI model", 100),
    );
  });
  handle("ai:choose-executable", async (payload) => {
    const provider = requireString(
      requireObject(payload).provider,
      "AI provider",
      20,
    );
    if (!["codex", "claude"].includes(provider)) {
      throw new Error("Invalid AI provider.");
    }
    const label = provider === "codex" ? "Codex" : "Claude";
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Locate the ${label} CLI executable`,
      buttonLabel: `Use ${label} CLI`,
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return aiRunner.status();
    return aiRunner.setExecutable(provider, result.filePaths[0]);
  });
  handle("ai:accept-disclosure", async (payload) => {
    const provider = requireString(
      requireObject(payload).provider,
      "AI provider",
      20,
    );
    if (!["codex", "claude"].includes(provider)) {
      throw new Error("Invalid AI provider.");
    }
    if (settingsStore.aiSettings().disclosureAccepted[provider]) return true;
    if (process.env.LOCAL_STATUS_TEST_ACCEPT_AI_DISCLOSURE === "1") {
      await aiRunner.acceptDisclosure(provider);
      return true;
    }
    const label = provider === "codex" ? "Codex" : "Claude";
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: `Send staged changes to ${label}?`,
      message: `${label} needs the staged diff to draft a commit message.`,
      detail:
        `The staged diff, file names, statistics, and recent commit subjects will be processed through your configured ${label} account or provider. Local Status does not read or store your ${label} credentials.`,
      buttons: ["Continue", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) return false;
    await aiRunner.acceptDisclosure(provider);
    return true;
  });
  handle("ai:generate-commit-message", async (payload) => {
    const request = validateAiGeneration(payload);
    const context = await commitMessageContext(
      request.repositoryId,
      request.snapshotId,
    );
    return aiRunner.generate(request.requestId, context);
  });
  handle("ai:cancel-generation", (payload) =>
    aiRunner.cancel(
      requireString(
        requireObject(payload).requestId,
        "generation request",
        100,
      ),
    ),
  );

  handle("profiles:list", () =>
    getWorkspaceRoot() ? settingsStore.profilesFor(getWorkspaceRoot()) : [],
  );
  handle("profiles:save", async (payload) => {
    const profile = validateProfileInput(requireObject(payload).profile);
    const repository = await getRepository(profile.repositoryId);
    await validatedWorkingDirectory(repository.path, profile.cwdRelative);
    return settingsStore.saveProfile(getWorkspaceRoot(), profile);
  });
  handle("profiles:remove", (payload) =>
    settingsStore.removeProfile(
      getWorkspaceRoot(),
      requireString(requireObject(payload).profileId, "profile"),
    ),
  );

  handle("terminals:list", () => terminalManager.list());
  handle("terminals:create", async (payload) =>
    terminalManager.create(await terminalSpec(payload)),
  );
  handle("terminals:write", (payload) => {
    const request = requireObject(payload);
    terminalManager.write(
      requireString(request.sessionId, "terminal"),
      typeof request.data === "string" ? request.data : "",
    );
  });
  handle("terminals:resize", (payload) => {
    const request = requireObject(payload);
    terminalManager.resize(
      requireString(request.sessionId, "terminal"),
      Number(request.cols),
      Number(request.rows),
    );
  });
  handle("terminals:stop", (payload) =>
    terminalManager.stop(requireString(requireObject(payload).sessionId, "terminal")),
  );
  handle("terminals:restart", (payload) =>
    terminalManager.restart(
      requireString(requireObject(payload).sessionId, "terminal"),
    ),
  );
  handle("terminals:rename", (payload) => {
    const request = requireObject(payload);
    return terminalManager.rename(
      requireString(request.sessionId, "terminal"),
      requireString(request.title, "terminal name", 80),
    );
  });
  handle("terminals:close", (payload) =>
    terminalManager.close(requireString(requireObject(payload).sessionId, "terminal")),
  );

  handle("system:listeners", () => localListeners());
  handle("system:open-local-url", async (payload) => {
    const value = requireString(requireObject(payload).url, "URL", 2_048);
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      throw new Error("Only localhost HTTP links can be opened from a terminal.");
    }
    await shell.openExternal(url.toString());
  });
}

async function registerRendererProtocol() {
  protocol.handle("local-status", async (request) => {
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const filePath = resolve(rendererRoot, relativePath);
    const fromRoot = relative(rendererRoot, filePath);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Local Status",
    icon: appIconPath,
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 620,
    backgroundColor: "#09110f",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (process.platform !== "darwin") mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    const allowed = developmentUrl
      ? navigationUrl.startsWith(developmentUrl)
      : navigationUrl.startsWith("local-status://app/");
    if (!allowed) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (developmentUrl) {
    await mainWindow.loadURL(developmentUrl);
  } else {
    await mainWindow.loadURL("local-status://app/index.html");
  }
}

async function startApplication() {
  await app.whenReady();
  configureApplicationIdentity();
  if (!developmentUrl) await registerRendererProtocol();
  settingsStore = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  await settingsStore.load();
  aiRunner = new AiRunner({
    settingsStore,
    schemaPath: commitMessageSchemaPath,
    temporaryDirectory: app.getPath("temp"),
  });
  githubService = new GithubService();
  workspaceManager = new WorkspaceManager(settingsStore);
  await workspaceManager.restore();
  if (process.env.LOCAL_STATUS_TEST_WORKSPACE) {
    await workspaceManager.open(process.env.LOCAL_STATUS_TEST_WORKSPACE);
  }
  terminalManager = new TerminalManager({
    spawnPty: pty.spawn,
    emit: (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminals:event", event);
      }
    },
  });
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (!mainWindow) await createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting || !terminalManager.hasRunningSessions()) {
      aiRunner.stopAll();
      return;
    }
    event.preventDefault();
    void dialog
      .showMessageBox(mainWindow, {
        type: "warning",
        title: "Quit Local Status?",
        message: "Running terminal sessions will be stopped.",
        buttons: ["Stop terminals and quit", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      })
      .then(async (result) => {
        if (result.response !== 0) return;
        quitting = true;
    aiRunner.stopAll();
        await terminalManager.stopAll();
        app.quit();
      });
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  void startApplication().catch((error) => {
    console.error("Local Status could not start.", error);
    app.quit();
  });
}
