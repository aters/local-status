// @vitest-environment node
import { mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../electron/settings-store.mjs";
import {
  validateWorkspace,
  WorkspaceError,
} from "../electron/workspace-manager.mjs";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SettingsStore", () => {
  it("persists all registered themes and rejects unknown values", async () => {
    const directory = temporaryDirectory("local-status-themes-");
    const settingsPath = join(directory, "settings.json");
    const store = new SettingsStore(settingsPath);
    await store.load();

    await expect(store.setTheme("glass")).resolves.toEqual({ theme: "glass" });
    await expect(store.setTheme("neumorphic")).resolves.toEqual({
      theme: "neumorphic",
    });
    await expect(store.setTheme("liquid-glass")).resolves.toEqual({
      theme: "liquid-glass",
    });
    await expect(store.setTheme("unknown")).rejects.toThrow("Invalid theme.");

    const restored = new SettingsStore(settingsPath);
    await restored.load();
    expect(restored.preferences()).toEqual({ theme: "liquid-glass" });
  });

  it("falls back to Green when a saved theme is unknown", async () => {
    const directory = temporaryDirectory("local-status-invalid-theme-");
    const settingsPath = join(directory, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 6,
        lastWorkspacePath: null,
        recentWorkspaces: [],
        profiles: {},
        theme: "future-theme",
      }),
    );
    const store = new SettingsStore(settingsPath);

    await store.load();

    expect(store.preferences()).toEqual({ theme: "green" });
  });

  it("persists recent workspaces and profiles without storing environment values", async () => {
    const directory = temporaryDirectory("local-status-settings-");
    const settingsPath = join(directory, "settings.json");
    const workspace = temporaryDirectory("local-status-selected-");
    const store = new SettingsStore(settingsPath);
    await store.load();
    await store.rememberWorkspace(workspace);
    await store.setRepositoryName(
      workspace,
      "checkout-feature",
      "Feature checkout",
    );
    await store.setArchivedRepository(workspace, "checkout-archived", true);
    await store.saveProfile(workspace, {
      id: "profile-00000000000000000001",
      repositoryId: "api",
      name: "API",
      executable: "python3",
      args: ["-m", "http.server"],
      cwdRelative: ".",
    });
    await store.setAiExecutable("codex", "/opt/homebrew/bin/codex");
    await store.setAiExecutable("claude", "/usr/local/bin/claude");
    await store.setAiPreferences("claude", "sonnet");
    await store.acceptAiDisclosure("codex");

    const restored = new SettingsStore(settingsPath);
    await restored.load();

    expect(restored.data.lastWorkspacePath).toBe(workspace);
    expect(restored.recentWorkspaceSummaries()[0]).toMatchObject({ path: workspace });
    expect(
      restored.repositoryNameFor(workspace, "checkout-feature"),
    ).toBe("Feature checkout");
    expect(restored.archivedRepositoriesFor(workspace)).toEqual([
      "checkout-archived",
    ]);
    expect(restored.profilesFor(workspace)).toEqual([
      expect.objectContaining({ name: "API", executable: "python3" }),
    ]);
    expect(restored.aiSettings()).toEqual({
      provider: "claude",
      models: { codex: "gpt-5.6-luna", claude: "sonnet" },
      executablePaths: {
        codex: "/opt/homebrew/bin/codex",
        claude: "/usr/local/bin/claude",
      },
      disclosureAccepted: { codex: true, claude: false },
    });
    expect(JSON.stringify(restored.data)).not.toContain("env");
  });

  it("migrates version-one settings without losing workspace data", async () => {
    const directory = temporaryDirectory("local-status-settings-migration-");
    const settingsPath = join(directory, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 1,
        lastWorkspacePath: "/tmp/legacy-workspace",
        recentWorkspaces: ["/tmp/legacy-workspace"],
        profiles: {
          "/tmp/legacy-workspace": [
            {
              id: "profile-00000000000000000001",
              repositoryId: "web",
              name: "Web",
              executable: "npm",
              args: ["run", "dev"],
              cwdRelative: ".",
            },
          ],
        },
      }),
    );
    const store = new SettingsStore(settingsPath);

    await store.load();

    expect(store.data.version).toBe(6);
    expect(store.data.lastWorkspacePath).toBe("/tmp/legacy-workspace");
    expect(store.profilesFor("/tmp/legacy-workspace")).toHaveLength(1);
    expect(store.aiSettings()).toEqual({
      provider: "codex",
      models: { codex: "gpt-5.6-luna", claude: "haiku" },
      executablePaths: { codex: null, claude: null },
      disclosureAccepted: { codex: false, claude: false },
    });
  });

  it("migrates version-two Codex preferences into provider-neutral AI settings", async () => {
    const directory = temporaryDirectory("local-status-settings-ai-migration-");
    const settingsPath = join(directory, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 2,
        lastWorkspacePath: null,
        recentWorkspaces: [],
        profiles: {},
        codex: {
          executablePath: "/opt/homebrew/bin/codex",
          disclosureAccepted: true,
        },
      }),
    );
    const store = new SettingsStore(settingsPath);

    await store.load();

    expect(store.aiSettings()).toMatchObject({
      provider: "codex",
      executablePaths: { codex: "/opt/homebrew/bin/codex" },
      disclosureAccepted: { codex: true, claude: false },
    });
  });

  it("backs up corrupt settings and recovers with defaults", async () => {
    const directory = temporaryDirectory("local-status-corrupt-");
    const settingsPath = join(directory, "settings.json");
    writeFileSync(settingsPath, "{ definitely not json");
    const store = new SettingsStore(settingsPath);

    await store.load();

    expect(store.data.lastWorkspacePath).toBeNull();
    expect(readdirSync(directory).some((entry) => entry.startsWith("settings.json.corrupt-"))).toBe(
      true,
    );
  });

  it("ignores invalid saved worktree names and validates new names", async () => {
    const directory = temporaryDirectory("local-status-worktree-names-");
    const settingsPath = join(directory, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 6,
        lastWorkspacePath: "/tmp/workspace",
        recentWorkspaces: ["/tmp/workspace"],
        repositoryNames: {
          "/tmp/workspace": {
            "checkout-valid": "  Product feature  ",
            "checkout-invalid": " ",
          },
        },
      }),
    );
    const store = new SettingsStore(settingsPath);

    await store.load();

    expect(
      store.repositoryNameFor("/tmp/workspace", "checkout-valid"),
    ).toBe("Product feature");
    expect(
      store.repositoryNameFor("/tmp/workspace", "checkout-invalid"),
    ).toBeNull();
    await expect(
      store.setRepositoryName("/tmp/workspace", "checkout-valid", " "),
    ).rejects.toThrow(
      "Worktree names must be between 1 and 80 characters.",
    );
  });
});

describe("validateWorkspace", () => {
  it("canonicalizes readable directories and rejects missing or relative paths", async () => {
    const directory = temporaryDirectory("local-status-workspace-validation-");
    await expect(validateWorkspace(directory)).resolves.toMatchObject({
      path: realpathSync(directory),
    });
    await expect(validateWorkspace("relative/path")).rejects.toBeInstanceOf(
      WorkspaceError,
    );
    await expect(
      validateWorkspace(join(directory, "missing")),
    ).rejects.toMatchObject({ code: "WORKSPACE_UNAVAILABLE" });
  });
});
