import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { setWorkspaceRoot } from "../server/git-service.mjs";

export class WorkspaceError extends Error {
  constructor(message, code = "INVALID_WORKSPACE") {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export async function validateWorkspace(candidate) {
  if (typeof candidate !== "string" || !candidate || !isAbsolute(candidate)) {
    throw new WorkspaceError("Choose a valid workspace folder.");
  }
  try {
    const canonicalPath = await realpath(candidate);
    const details = await stat(canonicalPath);
    if (!details.isDirectory()) {
      throw new WorkspaceError("The selected workspace is not a folder.");
    }
    await access(canonicalPath, constants.R_OK);
    return { path: canonicalPath, name: basename(canonicalPath) || canonicalPath };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(
      "The selected workspace is missing or cannot be read.",
      "WORKSPACE_UNAVAILABLE",
    );
  }
}

export class WorkspaceManager {
  constructor(settingsStore) {
    this.settingsStore = settingsStore;
    this.current = null;
  }

  async restore() {
    const candidate = this.settingsStore.data.lastWorkspacePath;
    if (!candidate) {
      setWorkspaceRoot(null);
      return this.state();
    }
    try {
      this.current = await validateWorkspace(candidate);
      setWorkspaceRoot(this.current.path);
    } catch {
      this.current = null;
      setWorkspaceRoot(null);
      await this.settingsStore.forgetCurrentWorkspace();
    }
    return this.state();
  }

  async open(path) {
    this.current = await validateWorkspace(path);
    setWorkspaceRoot(this.current.path);
    await this.settingsStore.rememberWorkspace(this.current.path);
    return this.state();
  }

  state() {
    return {
      current: this.current,
      recent: this.settingsStore.recentWorkspaceSummaries(),
    };
  }
}
