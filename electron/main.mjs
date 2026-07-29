import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from "electron";
import pty from "node-pty";
import {
  commitDetails,
  comparisonContents,
  fetchAll,
  fetchOne,
  getRepository,
  getWorkspaceRoot,
  listRepositorySummaries,
  localListeners,
  repositoryChanges,
  repositoryCommits,
  repositoryFiles,
} from "../server/git-service.mjs";
import { discoverScripts } from "./script-discovery.mjs";
import { SettingsStore } from "./settings-store.mjs";
import { TerminalManager } from "./terminal-manager.mjs";
import { WorkspaceManager } from "./workspace-manager.mjs";

const appDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererRoot = join(appDirectory, "dist");
const preloadPath = join(appDirectory, "electron", "preload.cjs");
const developmentUrl = process.env.LOCAL_STATUS_DEV_URL || null;

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
let quitting = false;

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
    if (!(await confirmStopForWorkspaceChange())) return workspaceManager.state();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a multi-repository workspace",
      buttonLabel: "Use workspace",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return workspaceManager.state();
    return workspaceManager.open(result.filePaths[0]);
  });
  handle("workspace:open", async (payload) => {
    if (!(await confirmStopForWorkspaceChange())) return workspaceManager.state();
    return workspaceManager.open(requireString(requireObject(payload).path, "workspace path"));
  });

  handle("repositories:list", () => listRepositorySummaries());
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
  handle("repositories:fetch", (payload) =>
    fetchOne(requireString(requireObject(payload).repositoryId, "repository")),
  );
  handle("repositories:fetch-all", () => fetchAll());
  handle("repositories:scripts", async (payload) => {
    const repositoryId = requireString(
      requireObject(payload).repositoryId,
      "repository",
    );
    const repository = await getRepository(repositoryId);
    return { repositoryId, scripts: await discoverScripts(repository.path) };
  });

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
  mainWindow.removeMenu();
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
  app.setName("Local Status");
  if (!developmentUrl) await registerRendererProtocol();
  settingsStore = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  await settingsStore.load();
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
    if (quitting || !terminalManager.hasRunningSessions()) return;
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
