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
  it("persists recent workspaces and profiles without storing environment values", async () => {
    const directory = temporaryDirectory("local-status-settings-");
    const settingsPath = join(directory, "settings.json");
    const workspace = temporaryDirectory("local-status-selected-");
    const store = new SettingsStore(settingsPath);
    await store.load();
    await store.rememberWorkspace(workspace);
    await store.saveProfile(workspace, {
      id: "profile-00000000000000000001",
      repositoryId: "api",
      name: "API",
      executable: "python3",
      args: ["-m", "http.server"],
      cwdRelative: ".",
    });

    const restored = new SettingsStore(settingsPath);
    await restored.load();

    expect(restored.data.lastWorkspacePath).toBe(workspace);
    expect(restored.recentWorkspaceSummaries()[0]).toMatchObject({ path: workspace });
    expect(restored.profilesFor(workspace)).toEqual([
      expect.objectContaining({ name: "API", executable: "python3" }),
    ]);
    expect(JSON.stringify(restored.data)).not.toContain("env");
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
