// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitServiceError,
  comparisonContents,
  fetchOne,
  listRepositorySummaries,
  parsePorcelainV2,
  repositoryChanges,
  repositoryCommits,
  repositoryFiles,
  setWorkspaceRoot,
} from "../server/git-service.mjs";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(directory, ...args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureUser(repository) {
  git(repository, "config", "user.email", "workspace-test@local-status.test");
  git(repository, "config", "user.name", "Local Status Test");
}

afterEach(async () => {
  setWorkspaceRoot(null);
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("parsePorcelainV2", () => {
  it("separates staged, working, renamed, conflict, and untracked changes", () => {
    const output = [
      "# branch.oid abcdef",
      "# branch.head staging",
      "# branch.upstream origin/staging",
      "# branch.ab +3 -7",
      "1 MM N... 100644 100644 100644 aaa bbb src/file with spaces.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts",
      "src/old.ts",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts",
      "? src/new file.md",
      "",
    ].join("\0");

    const parsed = parsePorcelainV2(output);

    expect(parsed.branch).toMatchObject({
      head: "staging",
      upstream: "origin/staging",
      ahead: 3,
      behind: 7,
    });
    expect(parsed.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/file with spaces.ts", scope: "staged" }),
        expect.objectContaining({ path: "src/file with spaces.ts", scope: "working" }),
        expect.objectContaining({
          path: "src/new.ts",
          previousPath: "src/old.ts",
          kind: "renamed",
        }),
        expect.objectContaining({ path: "src/conflict.ts", scope: "conflict" }),
        expect.objectContaining({ path: "src/new file.md", scope: "untracked" }),
      ]),
    );
  });
});

describe("local Git integration", () => {
  it("discovers direct repositories and reports changes, comparisons, files, fetch, and divergence", async () => {
    const workspace = temporaryDirectory("local-status-workspace-");
    const remote = temporaryDirectory("local-status-remote-");
    const producer = temporaryDirectory("local-status-producer-");
    const repository = join(workspace, "product-api");

    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "tracked.ts"), "export const value = 1;\n");
    writeFileSync(join(repository, "delete-me.ts"), "export const removed = true;\n");
    writeFileSync(join(repository, "rename-me.ts"), "export const renamed = true;\n");
    git(repository, "add", "tracked.ts", "delete-me.ts", "rename-me.ts");
    git(repository, "commit", "-m", "Initial commit");
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "-u", "origin", "main");

    writeFileSync(join(repository, "tracked.ts"), "export const value = 2;\n");
    writeFileSync(join(repository, "staged.ts"), "export const staged = true;\n");
    git(repository, "add", "staged.ts");
    writeFileSync(join(repository, "untracked.md"), "# Local work\n");
    writeFileSync(join(repository, "unicode spaced λ.md"), "# Unicode path\n");
    writeFileSync(join(repository, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(repository, "large.txt"), "x".repeat(1_050_000));
    rmSync(join(repository, "delete-me.ts"));
    git(repository, "mv", "rename-me.ts", "renamed file.ts");

    setWorkspaceRoot(workspace);
    const summaries = await listRepositorySummaries();
    expect(summaries.repositories).toHaveLength(1);
    expect(summaries.repositories[0]).toMatchObject({
      id: "product-api",
      branch: "main",
      incoming: 0,
      outgoing: 0,
    });
    expect(summaries.repositories[0].summary.files).toBeGreaterThanOrEqual(7);

    const changes = await repositoryChanges("product-api");
    expect(changes.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "tracked.ts", scope: "working" }),
        expect.objectContaining({ path: "staged.ts", scope: "staged" }),
        expect.objectContaining({ path: "untracked.md", scope: "untracked" }),
        expect.objectContaining({ path: "delete-me.ts", scope: "working" }),
        expect.objectContaining({
          path: "renamed file.ts",
          previousPath: "rename-me.ts",
          scope: "staged",
        }),
      ]),
    );

    const comparison = await comparisonContents("product-api", {
      path: "tracked.ts",
      scope: "working",
    });
    expect(comparison.original.content).toContain("value = 1");
    expect(comparison.modified.content).toContain("value = 2");

    const deleted = await comparisonContents("product-api", {
      path: "delete-me.ts",
      scope: "working",
    });
    expect(deleted.original.content).toContain("removed = true");
    expect(deleted.modified.missing).toBe(true);

    const renamed = await comparisonContents("product-api", {
      path: "renamed file.ts",
      previousPath: "rename-me.ts",
      scope: "staged",
    });
    expect(renamed.original.content).toContain("renamed = true");
    expect(renamed.modified.content).toContain("renamed = true");

    const binary = await comparisonContents("product-api", {
      path: "binary.bin",
      scope: "untracked",
    });
    expect(binary.modified.binary).toBe(true);
    const large = await comparisonContents("product-api", {
      path: "large.txt",
      scope: "untracked",
    });
    expect(large.modified.truncated).toBe(true);

    const files = await repositoryFiles("product-api");
    expect(files.files).toEqual(
      expect.arrayContaining(["tracked.ts", "staged.ts", "untracked.md"]),
    );

    execFileSync("git", ["clone", remote, producer], { stdio: "ignore" });
    configureUser(producer);
    writeFileSync(join(producer, "remote.ts"), "export const remote = true;\n");
    git(producer, "add", "remote.ts");
    git(producer, "commit", "-m", "Remote commit");
    git(producer, "push", "origin", "main");

    await fetchOne("product-api");
    git(repository, "add", "tracked.ts");
    git(repository, "commit", "-m", "Local commit");

    const diverged = await listRepositorySummaries();
    expect(diverged.repositories[0]).toMatchObject({ incoming: 1, outgoing: 1 });
    expect((await repositoryCommits("product-api", "incoming")).commits).toHaveLength(1);
    expect((await repositoryCommits("product-api", "outgoing")).commits).toHaveLength(1);
  });

  it("rejects traversal instead of reading outside a repository", async () => {
    const workspace = temporaryDirectory("local-status-traversal-");
    const repository = join(workspace, "safe-repo");
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "safe.txt"), "safe\n");
    git(repository, "add", "safe.txt");
    git(repository, "commit", "-m", "Safe");
    setWorkspaceRoot(workspace);

    await expect(
      comparisonContents("safe-repo", {
        path: "../../outside.txt",
        scope: "working",
      }),
    ).rejects.toBeInstanceOf(GitServiceError);
  });

  it("excludes the workspace root, reports unborn/detached repositories, and deduplicates symlinks", async () => {
    const workspace = temporaryDirectory("local-status-discovery-");
    execFileSync("git", ["init", "-b", "main", workspace], { stdio: "ignore" });
    configureUser(workspace);
    writeFileSync(join(workspace, "root.txt"), "workspace root\n");
    git(workspace, "add", "root.txt");
    git(workspace, "commit", "-m", "Workspace root");

    const unborn = join(workspace, "empty-repo");
    const detached = join(workspace, "detached-repo");
    execFileSync("git", ["init", "-b", "main", unborn], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "main", detached], { stdio: "ignore" });
    configureUser(detached);
    writeFileSync(join(detached, "file.txt"), "detached\n");
    git(detached, "add", "file.txt");
    git(detached, "commit", "-m", "Detached commit");
    git(detached, "checkout", "--detach");
    symlinkSync(detached, join(workspace, "detached-alias"));

    const grouping = join(workspace, "group");
    const nested = join(grouping, "nested-repo");
    mkdirSync(grouping);
    execFileSync("git", ["init", "-b", "main", nested], { stdio: "ignore" });

    setWorkspaceRoot(workspace);
    const result = await listRepositorySummaries();

    expect(result.repositories).toHaveLength(2);
    expect(result.repositories.some((repository) => repository.id === "empty-repo")).toBe(true);
    expect(result.repositories.find((repository) => repository.id === "empty-repo")).toMatchObject({
      unborn: true,
      upstream: null,
      incoming: 0,
      outgoing: 0,
    });
    expect(result.repositories.find((repository) => repository.detached)).toMatchObject({
      detached: true,
      upstream: null,
    });
    expect(result.repositories.some((repository) => repository.id === "nested-repo")).toBe(false);
  });
});
