import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

const SETTINGS_VERSION = 3;
const MAX_RECENT_WORKSPACES = 8;

function defaults() {
  return {
    version: SETTINGS_VERSION,
    lastWorkspacePath: null,
    recentWorkspaces: [],
    profiles: {},
    ai: {
      provider: "codex",
      models: {
        codex: "gpt-5.6-luna",
        claude: "haiku",
      },
      executablePaths: {
        codex: null,
        claude: null,
      },
      disclosureAccepted: {
        codex: false,
        claude: false,
      },
    },
  };
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validProfile(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.repositoryId === "string" &&
    typeof value.name === "string" &&
    typeof value.executable === "string" &&
    isStringArray(value.args) &&
    typeof value.cwdRelative === "string"
  );
}

function parseSettings(value) {
  if (
    !value ||
    typeof value !== "object" ||
    ![1, 2, SETTINGS_VERSION].includes(value.version)
  ) {
    return defaults();
  }
  const profiles = {};
  if (value.profiles && typeof value.profiles === "object") {
    for (const [workspace, entries] of Object.entries(value.profiles)) {
      if (Array.isArray(entries)) profiles[workspace] = entries.filter(validProfile);
    }
  }
  return {
    version: SETTINGS_VERSION,
    lastWorkspacePath:
      typeof value.lastWorkspacePath === "string" ? value.lastWorkspacePath : null,
    recentWorkspaces: isStringArray(value.recentWorkspaces)
      ? value.recentWorkspaces.slice(0, MAX_RECENT_WORKSPACES)
      : [],
    profiles,
    ai: {
      provider: value.ai?.provider === "claude" ? "claude" : "codex",
      models: {
        codex:
          typeof value.ai?.models?.codex === "string"
            ? value.ai.models.codex
            : "gpt-5.6-luna",
        claude:
          typeof value.ai?.models?.claude === "string"
            ? value.ai.models.claude
            : "haiku",
      },
      executablePaths: {
        codex:
          typeof value.ai?.executablePaths?.codex === "string"
            ? value.ai.executablePaths.codex
            : typeof value.codex?.executablePath === "string"
              ? value.codex.executablePath
              : null,
        claude:
          typeof value.ai?.executablePaths?.claude === "string"
            ? value.ai.executablePaths.claude
            : null,
      },
      disclosureAccepted: {
        codex:
          value.ai?.disclosureAccepted?.codex === true ||
          value.codex?.disclosureAccepted === true,
        claude: value.ai?.disclosureAccepted?.claude === true,
      },
    },
  };
}

export class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = defaults();
  }

  async load() {
    try {
      this.data = parseSettings(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        await rename(this.filePath, backup).catch(() => undefined);
      }
      this.data = defaults();
    }
    return this.data;
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }

  async rememberWorkspace(workspacePath) {
    this.data.lastWorkspacePath = workspacePath;
    this.data.recentWorkspaces = [
      workspacePath,
      ...this.data.recentWorkspaces.filter((entry) => entry !== workspacePath),
    ].slice(0, MAX_RECENT_WORKSPACES);
    await this.save();
  }

  async forgetCurrentWorkspace() {
    this.data.lastWorkspacePath = null;
    await this.save();
  }

  profilesFor(workspacePath) {
    return [...(this.data.profiles[workspacePath] ?? [])];
  }

  async saveProfile(workspacePath, profile) {
    const entries = this.profilesFor(workspacePath);
    const index = entries.findIndex((entry) => entry.id === profile.id);
    if (index >= 0) entries[index] = profile;
    else entries.push(profile);
    this.data.profiles[workspacePath] = entries;
    await this.save();
    return this.profilesFor(workspacePath);
  }

  async removeProfile(workspacePath, profileId) {
    this.data.profiles[workspacePath] = this
      .profilesFor(workspacePath)
      .filter((entry) => entry.id !== profileId);
    await this.save();
    return this.profilesFor(workspacePath);
  }

  aiSettings() {
    return {
      ...this.data.ai,
      models: { ...this.data.ai.models },
      executablePaths: { ...this.data.ai.executablePaths },
      disclosureAccepted: { ...this.data.ai.disclosureAccepted },
    };
  }

  async setAiExecutable(provider, executablePath) {
    this.data.ai.executablePaths[provider] = executablePath;
    await this.save();
    return this.aiSettings();
  }

  async setAiPreferences(provider, model) {
    this.data.ai.provider = provider;
    this.data.ai.models[provider] = model;
    await this.save();
    return this.aiSettings();
  }

  async acceptAiDisclosure(provider) {
    this.data.ai.disclosureAccepted[provider] = true;
    await this.save();
    return this.aiSettings();
  }

  recentWorkspaceSummaries() {
    return this.data.recentWorkspaces.map((path) => ({ path, name: basename(path) }));
  }
}

export const __testing = { parseSettings, defaults };
