// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  setWorkspaceRoot,
  workspaceFiles,
} from "../server/git-service.mjs";

const temporaryDirectories = [];

function createRepository(workspace, name) {
  const repository = join(workspace, name);
  mkdirSync(repository);
  execFileSync("git", ["init", "-q", repository]);
  return repository;
}

afterEach(() => {
  setWorkspaceRoot(null);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("workspace file indexing", () => {
  it("indexes direct-child repositories, includes non-ignored untracked files, and caches", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "local-status-files-"));
    temporaryDirectories.push(workspace);
    execFileSync("git", ["init", "-q", workspace]);

    const web = createRepository(workspace, "web app");
    mkdirSync(join(web, "src"));
    writeFileSync(join(web, "src", "Résumé panel.tsx"), "export {};\n");
    writeFileSync(join(web, ".gitignore"), "ignored.log\n");
    writeFileSync(join(web, "ignored.log"), "private\n");

    const api = createRepository(workspace, "api");
    writeFileSync(join(api, "server.js"), "export default {};\n");
    symlinkSync(api, join(workspace, "api-alias"));

    setWorkspaceRoot(workspace);
    const first = await workspaceFiles();
    writeFileSync(join(api, "created-after-index.js"), "export {};\n");
    const cached = await workspaceFiles();

    expect(first.files).toEqual([
      { repositoryId: "api", path: "server.js" },
      { repositoryId: "web app", path: ".gitignore" },
      { repositoryId: "web app", path: "src/Résumé panel.tsx" },
    ]);
    expect(first.files).not.toContainEqual(
      expect.objectContaining({ path: "ignored.log" }),
    );
    expect(first.files.some((file) => file.repositoryId === "api-alias")).toBe(false);
    expect(first.files.some((file) => file.repositoryId === workspace)).toBe(false);
    expect(cached).toEqual(first);

    setWorkspaceRoot(workspace);
    const refreshed = await workspaceFiles();
    expect(refreshed.files).toContainEqual({
      repositoryId: "api",
      path: "created-after-index.js",
    });
  });
});
