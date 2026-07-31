import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import themeManifest from "../shared/themes.json" with { type: "json" };

const SETTINGS_VERSION = 7;
const MAX_RECENT_WORKSPACES = 8;
const MAX_REPOSITORY_NAME_LENGTH = 80;
const THEMES = new Set(Object.keys(themeManifest));
const APPEARANCE_MODES = new Set(["light", "dark", "system"]);

function defaults() {
  return {
    version: SETTINGS_VERSION,
    lastWorkspacePath: null,
    recentWorkspaces: [],
    repositoryNames: {},
    profiles: {},
    theme: "green",
    liquidGlassAppearance: "system",
    favouriteRepositoryGroups: {},
    archivedRepositoryGroups: {},
    archivedRepositories: {},
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
      conflictDisclosureAccepted: {
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
    ![1, 2, 3, 4, 5, 6, SETTINGS_VERSION].includes(value.version)
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
    repositoryNames:
      value.repositoryNames &&
      typeof value.repositoryNames === "object" &&
      !Array.isArray(value.repositoryNames)
        ? Object.fromEntries(
            Object.entries(value.repositoryNames)
              .filter(
                ([, names]) =>
                  names && typeof names === "object" && !Array.isArray(names),
              )
              .map(([workspace, names]) => [
                workspace,
                Object.fromEntries(
                  Object.entries(names)
                    .filter(
                      ([, name]) =>
                        typeof name === "string" &&
                        name.trim().length > 0 &&
                        name.trim().length <= MAX_REPOSITORY_NAME_LENGTH,
                    )
                    .map(([groupId, name]) => [groupId, name.trim()]),
                ),
              ]),
          )
        : {},
    profiles,
    theme: THEMES.has(value.theme) ? value.theme : "green",
    liquidGlassAppearance: APPEARANCE_MODES.has(value.liquidGlassAppearance)
      ? value.liquidGlassAppearance
      : "system",
    favouriteRepositoryGroups:
      value.favouriteRepositoryGroups &&
      typeof value.favouriteRepositoryGroups === "object"
        ? Object.fromEntries(
            Object.entries(value.favouriteRepositoryGroups)
              .filter(([, entries]) => isStringArray(entries))
              .map(([workspace, entries]) => [workspace, [...new Set(entries)]]),
          )
        : {},
    archivedRepositoryGroups:
      value.archivedRepositoryGroups &&
      typeof value.archivedRepositoryGroups === "object"
        ? Object.fromEntries(
            Object.entries(value.archivedRepositoryGroups)
              .filter(([, entries]) => isStringArray(entries))
              .map(([workspace, entries]) => [workspace, [...new Set(entries)]]),
          )
        : {},
    archivedRepositories:
      value.archivedRepositories && typeof value.archivedRepositories === "object"
        ? Object.fromEntries(
            Object.entries(value.archivedRepositories)
              .filter(([, entries]) => isStringArray(entries))
              .map(([workspace, entries]) => [workspace, [...new Set(entries)]]),
          )
        : {},
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
      conflictDisclosureAccepted: {
        codex: value.ai?.conflictDisclosureAccepted?.codex === true,
        claude: value.ai?.conflictDisclosureAccepted?.claude === true,
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

  repositoryNameFor(workspacePath, repositoryId) {
    return this.data.repositoryNames[workspacePath]?.[repositoryId] ?? null;
  }

  async setRepositoryName(workspacePath, repositoryId, name) {
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName || normalizedName.length > MAX_REPOSITORY_NAME_LENGTH) {
      throw new Error(
        `Worktree names must be between 1 and ${MAX_REPOSITORY_NAME_LENGTH} characters.`,
      );
    }
    this.data.repositoryNames[workspacePath] = {
      ...(this.data.repositoryNames[workspacePath] ?? {}),
      [repositoryId]: normalizedName,
    };
    await this.save();
    return normalizedName;
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

  preferences() {
    return {
      theme: this.data.theme,
      liquidGlassAppearance: this.data.liquidGlassAppearance,
    };
  }

  async setTheme(theme) {
    if (!THEMES.has(theme)) throw new Error("Invalid theme.");
    this.data.theme = theme;
    await this.save();
    return this.preferences();
  }

  async setLiquidGlassAppearance(appearance) {
    if (!APPEARANCE_MODES.has(appearance)) {
      throw new Error("Invalid Liquid Glass appearance.");
    }
    this.data.liquidGlassAppearance = appearance;
    await this.save();
    return this.preferences();
  }

  favouriteGroupsFor(workspacePath) {
    return [...(this.data.favouriteRepositoryGroups[workspacePath] ?? [])];
  }

  async setFavouriteGroup(workspacePath, groupId, favourite) {
    const groups = new Set(this.favouriteGroupsFor(workspacePath));
    if (favourite) groups.add(groupId);
    else groups.delete(groupId);
    this.data.favouriteRepositoryGroups[workspacePath] = [...groups];
    await this.save();
    return this.favouriteGroupsFor(workspacePath);
  }

  archivedGroupsFor(workspacePath) {
    return [...(this.data.archivedRepositoryGroups[workspacePath] ?? [])];
  }

  async setArchivedGroup(workspacePath, groupId, archived) {
    const groups = new Set(this.archivedGroupsFor(workspacePath));
    if (archived) groups.add(groupId);
    else groups.delete(groupId);
    this.data.archivedRepositoryGroups[workspacePath] = [...groups];
    await this.save();
    return this.archivedGroupsFor(workspacePath);
  }

  archivedRepositoriesFor(workspacePath) {
    return [...(this.data.archivedRepositories[workspacePath] ?? [])];
  }

  async setArchivedRepository(workspacePath, repositoryId, archived) {
    const repositories = new Set(this.archivedRepositoriesFor(workspacePath));
    if (archived) repositories.add(repositoryId);
    else repositories.delete(repositoryId);
    this.data.archivedRepositories[workspacePath] = [...repositories];
    await this.save();
    return this.archivedRepositoriesFor(workspacePath);
  }

  aiSettings() {
    return {
      ...this.data.ai,
      models: { ...this.data.ai.models },
      executablePaths: { ...this.data.ai.executablePaths },
      disclosureAccepted: { ...this.data.ai.disclosureAccepted },
      conflictDisclosureAccepted: {
        ...this.data.ai.conflictDisclosureAccepted,
      },
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

  async acceptAiConflictDisclosure(provider) {
    this.data.ai.conflictDisclosureAccepted[provider] = true;
    await this.save();
    return this.aiSettings();
  }

  recentWorkspaceSummaries() {
    return this.data.recentWorkspaces.map((path) => ({ path, name: basename(path) }));
  }
}

export const __testing = { parseSettings, defaults };
