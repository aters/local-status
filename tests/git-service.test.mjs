// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyStash,
  cleanGitError,
  GitServiceError,
  commitMessageContext,
  comparisonContents,
  createStash,
  createCommit,
  dropStash,
  fetchOne,
  listRepositorySummaries,
  parsePorcelainV2,
  prepareCommit,
  repositoryBranches,
  repositoryChanges,
  repositoryCommits,
  repositoryFiles,
  repositoryStashes,
  revertChanges,
  setWorkspaceRoot,
  stageChanges,
  stashDetails,
  syncRepository,
  unstageChanges,
  popStash,
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

describe("branch selection", () => {
  it("prioritizes common branches and hides remotes that already exist locally", async () => {
    const workspace = temporaryDirectory("local-status-branches-");
    const repository = join(workspace, "branches");
    execFileSync("git", ["init", "-b", "feature/current", repository], {
      stdio: "ignore",
    });
    configureUser(repository);
    writeFileSync(join(repository, "tracked.txt"), "base\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Initial commit");
    for (const branch of ["zeta", "staging", "main", "master", "alpha"]) {
      git(repository, "branch", branch);
    }
    for (const branch of [
      "zeta",
      "staging",
      "main",
      "master",
      "alpha",
      "remote-only",
    ]) {
      git(repository, "update-ref", `refs/remotes/origin/${branch}`, "HEAD");
    }
    setWorkspaceRoot(workspace);

    const branches = await repositoryBranches("branches");

    expect(branches.local.map((branch) => branch.name)).toEqual([
      "main",
      "master",
      "staging",
      "feature/current",
      "alpha",
      "zeta",
    ]);
    expect(branches.remote.map((branch) => branch.name)).toEqual([
      "origin/remote-only",
    ]);
  });
});

describe("stash management", () => {
  it("filters maintenance chatter and preserves the real Git failure", () => {
    expect(
      cleanGitError({
        stderr: [
          "Auto packing the repository in background for optimum performance.",
          "See 'git help gc' for manual housekeeping.",
          "fatal: the actual operation failed",
        ].join("\n"),
      }),
    ).toBe("the actual operation failed");
    expect(
      cleanGitError({
        stderr: [
          "Auto packing the repository in background for optimum performance.",
          "See 'git help gc' for manual housekeeping.",
        ].join("\n"),
      }),
    ).toBe("Git could not complete the request.");
  });

  it("creates, inspects, applies, pops, and drops complete stashes", async () => {
    const workspace = temporaryDirectory("local-status-stash-workspace-");
    const repository = join(workspace, "stash-repo");
    mkdirSync(repository);
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, ".gitignore"), "ignored.log\n");
    writeFileSync(join(repository, "mixed.txt"), "base\n");
    writeFileSync(join(repository, "other.txt"), "other base\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Base");

    writeFileSync(join(repository, "mixed.txt"), "base\nstaged\n");
    git(repository, "add", "mixed.txt");
    writeFileSync(join(repository, "mixed.txt"), "base\nstaged\nworking\n");
    writeFileSync(join(repository, "other.txt"), "other changed\n");
    writeFileSync(join(repository, "new file.txt"), "new\n");
    writeFileSync(join(repository, "ignored.log"), "ignored\n");

    setWorkspaceRoot(workspace);
    const created = await createStash("stash-repo", {
      message: "checkpoint",
      includeUntracked: true,
      path: null,
    });
    expect(created.stash).toMatchObject({
      message: "checkpoint",
      branch: "main",
      fileCount: 3,
    });
    expect(created.remainingFiles).toBe(0);
    expect(git(repository, "status", "--short")).toBe("");
    expect(readFileSync(join(repository, "ignored.log"), "utf8")).toBe("ignored\n");

    const listed = await repositoryStashes("stash-repo");
    expect(listed.stashes).toHaveLength(1);
    expect(listed.stashes[0].id).toBe(created.stash.id);
    const detail = await stashDetails("stash-repo", created.stash.id);
    expect(detail.files.map((file) => file.path).sort()).toEqual([
      "mixed.txt",
      "new file.txt",
      "other.txt",
    ]);
    const untrackedComparison = await comparisonContents("stash-repo", {
      path: "new file.txt",
      scope: "stash",
      stash: created.stash.id,
    });
    expect(untrackedComparison.original.missing).toBe(true);
    expect(untrackedComparison.modified.content).toBe("new\n");

    const applied = await applyStash("stash-repo", created.stash.id);
    expect(applied).toMatchObject({
      outcome: "applied",
      stashRetained: true,
    });
    expect(git(repository, "status", "--short")).toContain("MM mixed.txt");

    git(repository, "reset", "--hard", "HEAD");
    git(repository, "clean", "-fd");
    const popped = await popStash("stash-repo", created.stash.id);
    expect(popped).toMatchObject({
      outcome: "applied",
      stashRetained: false,
    });
    expect(await repositoryStashes("stash-repo")).toMatchObject({ stashes: [] });

    git(repository, "reset", "--hard", "HEAD");
    git(repository, "clean", "-fd");
    writeFileSync(join(repository, "mixed.txt"), "another checkpoint\n");
    const first = await createStash("stash-repo", {
      message: "first",
      includeUntracked: true,
    });
    writeFileSync(join(repository, "mixed.txt"), "newest checkpoint\n");
    await createStash("stash-repo", {
      message: "newest",
      includeUntracked: true,
    });
    await dropStash("stash-repo", first.stash.id);
    const remaining = await repositoryStashes("stash-repo");
    expect(remaining.stashes.map((stash) => stash.message)).toEqual(["newest"]);
    await expect(
      dropStash("stash-repo", first.stash.id),
    ).rejects.toMatchObject({ code: "STALE_STASH" });
  });

  it("stashes one file with its complete index state and leaves other work alone", async () => {
    const workspace = temporaryDirectory("local-status-file-stash-");
    const repository = join(workspace, "file-stash");
    mkdirSync(repository);
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "mixed file.txt"), "base\n");
    writeFileSync(join(repository, "other.txt"), "other base\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Base");
    writeFileSync(join(repository, "mixed file.txt"), "base\nstaged\n");
    git(repository, "add", "mixed file.txt");
    writeFileSync(
      join(repository, "mixed file.txt"),
      "base\nstaged\nworking\n",
    );
    writeFileSync(join(repository, "other.txt"), "other changed\n");

    setWorkspaceRoot(workspace);
    const created = await createStash("file-stash", {
      message: "one file",
      includeUntracked: true,
      path: "mixed file.txt",
    });
    expect(created.stash.fileCount).toBe(1);
    expect(git(repository, "status", "--short")).toBe("M other.txt");

    const restored = await applyStash("file-stash", created.stash.id);
    expect(restored.outcome).toBe("applied");
    expect(git(repository, "status", "--short").split("\n")).toEqual([
      'MM "mixed file.txt"',
      " M other.txt",
    ]);
    expect(readFileSync(join(repository, "mixed file.txt"), "utf8")).toBe(
      "base\nstaged\nworking\n",
    );
  });

  it("supports renamed Unicode paths and optional untracked exclusion", async () => {
    const workspace = temporaryDirectory("local-status-stash-paths-");
    const repository = join(workspace, "paths");
    mkdirSync(repository);
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "old ü.txt"), "rename\n");
    writeFileSync(join(repository, "tracked.txt"), "base\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Base");
    git(repository, "mv", "old ü.txt", "new ü.txt");
    writeFileSync(join(repository, "tracked.txt"), "changed\n");
    writeFileSync(join(repository, "untracked ü.txt"), "new\n");

    setWorkspaceRoot(workspace);
    const renamed = await createStash("paths", {
      message: "rename",
      includeUntracked: true,
      path: "new ü.txt",
    });
    const renameDetail = await stashDetails("paths", renamed.stash.id);
    expect(renameDetail.files).toEqual([
      expect.objectContaining({
        status: "R",
        previousPath: "old ü.txt",
        path: "new ü.txt",
      }),
    ]);
    expect(
      (
        await comparisonContents("paths", {
          path: "new ü.txt",
          previousPath: "old ü.txt",
          scope: "stash",
          stash: renamed.stash.id,
        })
      ).modified.content,
    ).toBe("rename\n");

    const trackedOnly = await createStash("paths", {
      message: "tracked only",
      includeUntracked: false,
    });
    expect(trackedOnly.stash.fileCount).toBe(1);
    expect((await repositoryChanges("paths")).changes).toEqual([
      expect.objectContaining({
        path: "untracked ü.txt",
        scope: "untracked",
      }),
    ]);
  });

  it("keeps a stash when restoration conflicts and rejects repositories without a commit", async () => {
    const workspace = temporaryDirectory("local-status-stash-conflict-");
    const repository = join(workspace, "conflict");
    const unborn = join(workspace, "unborn");
    mkdirSync(repository);
    mkdirSync(unborn);
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "main", unborn], { stdio: "ignore" });
    configureUser(repository);
    configureUser(unborn);
    writeFileSync(join(repository, "shared.txt"), "base\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Base");
    writeFileSync(join(repository, "shared.txt"), "stashed\n");
    writeFileSync(join(unborn, "first.txt"), "not committed\n");

    setWorkspaceRoot(workspace);
    const created = await createStash("conflict", {
      message: "will conflict",
      includeUntracked: true,
    });
    writeFileSync(join(repository, "shared.txt"), "new head\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Different change");

    const restored = await applyStash("conflict", created.stash.id);
    expect(restored).toMatchObject({
      outcome: "conflicts",
      stashRetained: true,
    });
    expect(restored.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "shared.txt", scope: "conflict" }),
      ]),
    );
    expect((await repositoryStashes("conflict")).stashes).toHaveLength(1);
    await expect(
      createStash("unborn", {
        message: "",
        includeUntracked: true,
      }),
    ).rejects.toMatchObject({ code: "STASH_REQUIRES_COMMIT" });
  });
});

describe("local Git integration", () => {
  it("stages, unstages, and safely reverts individual and grouped changes", async () => {
    const workspace = temporaryDirectory("local-status-actions-");
    const repository = join(workspace, "working-copy");
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "tracked.txt"), "committed\n");
    writeFileSync(join(repository, "old-name.txt"), "rename me\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Initial commit");

    writeFileSync(join(repository, "tracked.txt"), "working edit\n");
    writeFileSync(join(repository, "new file.md"), "# untracked\n");
    setWorkspaceRoot(workspace);

    await stageChanges("working-copy", { scope: "working", path: "tracked.txt" });
    expect((await repositoryChanges("working-copy")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "tracked.txt", scope: "staged" }),
      ]),
    );

    await unstageChanges("working-copy", { scope: "staged", path: "tracked.txt" });
    expect((await repositoryChanges("working-copy")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "tracked.txt", scope: "working" }),
      ]),
    );

    await stageChanges("working-copy", {
      scope: "unstaged",
      paths: ["tracked.txt", "new file.md"],
    });
    expect((await repositoryChanges("working-copy")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "tracked.txt", scope: "staged" }),
        expect.objectContaining({ path: "new file.md", scope: "staged" }),
      ]),
    );
    await unstageChanges("working-copy", {
      scope: "staged",
      paths: ["tracked.txt", "new file.md"],
    });

    await stageChanges("working-copy", { scope: "untracked" });
    expect((await repositoryChanges("working-copy")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "new file.md", scope: "staged" }),
      ]),
    );
    await unstageChanges("working-copy", {
      scope: "staged",
      path: "new file.md",
    });

    await stageChanges("working-copy", { scope: "unstaged" });
    expect((await repositoryChanges("working-copy")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "tracked.txt", scope: "staged" }),
        expect.objectContaining({ path: "new file.md", scope: "staged" }),
      ]),
    );
    await unstageChanges("working-copy", { scope: "staged" });

    await revertChanges("working-copy", { scope: "unstaged" });
    expect(readFileSync(join(repository, "tracked.txt"), "utf8")).toBe("committed\n");
    expect(existsSync(join(repository, "new file.md"))).toBe(false);

    writeFileSync(join(repository, "tracked.txt"), "batch edit\n");
    writeFileSync(join(repository, "old-name.txt"), "batch rename source edit\n");
    await revertChanges("working-copy", {
      scope: "working",
      paths: ["tracked.txt", "old-name.txt"],
    });
    expect(readFileSync(join(repository, "tracked.txt"), "utf8")).toBe("committed\n");
    expect(readFileSync(join(repository, "old-name.txt"), "utf8")).toBe(
      "rename me\n",
    );

    renameSync(join(repository, "old-name.txt"), join(repository, "new-name.txt"));
    expect((await repositoryChanges("working-copy")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "old-name.txt", scope: "working" }),
        expect.objectContaining({ path: "new-name.txt", scope: "untracked" }),
      ]),
    );
    await revertChanges("working-copy", { scope: "working" });
    await revertChanges("working-copy", { scope: "untracked" });
    expect(existsSync(join(repository, "old-name.txt"))).toBe(true);
    expect(existsSync(join(repository, "new-name.txt"))).toBe(false);

    await expect(
      stageChanges("working-copy", {
        scope: "untracked",
        path: "../../outside.txt",
      }),
    ).rejects.toBeInstanceOf(GitServiceError);
    await expect(
      stageChanges("working-copy", {
        scope: "unstaged",
        paths: ["tracked.txt", "../../outside.txt"],
      }),
    ).rejects.toBeInstanceOf(GitServiceError);
  });

  it("commits only the staged snapshot and rejects a stale commit window", async () => {
    const workspace = temporaryDirectory("local-status-commit-");
    const repository = join(workspace, "commit-repo");
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "tracked.txt"), "base\n");
    writeFileSync(join(repository, "other.txt"), "base\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Initial commit");

    writeFileSync(join(repository, "tracked.txt"), "staged version\n");
    git(repository, "add", "tracked.txt");
    writeFileSync(join(repository, "tracked.txt"), "working version\n");
    writeFileSync(join(repository, "untracked.txt"), "leave me alone\n");
    setWorkspaceRoot(workspace);

    const prepared = await prepareCommit("commit-repo");
    expect(prepared).toMatchObject({
      repositoryId: "commit-repo",
      branch: "main",
      detached: false,
      stagedFiles: [expect.objectContaining({ path: "tracked.txt" })],
    });
    const generationContext = await commitMessageContext(
      "commit-repo",
      prepared.snapshotId,
    );
    expect(generationContext.patch).toContain("staged version");
    expect(generationContext.patch).not.toContain("working version");
    expect(generationContext.recentSubjects).toContain("Initial commit");

    const result = await createCommit("commit-repo", {
      message: "Update tracked behavior\n\nExplain the staged change ✓",
      snapshotId: prepared.snapshotId,
    });
    expect(result.commit.subject).toBe("Update tracked behavior");
    expect(git(repository, "show", "HEAD:tracked.txt")).toBe("staged version");
    expect(readFileSync(join(repository, "tracked.txt"), "utf8")).toBe(
      "working version\n",
    );
    expect(readFileSync(join(repository, "untracked.txt"), "utf8")).toBe(
      "leave me alone\n",
    );
    expect(git(repository, "log", "-1", "--format=%B")).toContain(
      "Explain the staged change ✓",
    );

    writeFileSync(join(repository, "other.txt"), "first staged edit\n");
    git(repository, "add", "other.txt");
    const stale = await prepareCommit("commit-repo");
    writeFileSync(join(repository, "tracked.txt"), "second staged edit\n");
    git(repository, "add", "tracked.txt");
    await expect(
      createCommit("commit-repo", {
        message: "This must not commit",
        snapshotId: stale.snapshotId,
      }),
    ).rejects.toMatchObject({ code: "STAGED_CHANGES_CHANGED" });
  });

  it("supports initial and detached commits and rejects empty commit attempts", async () => {
    const workspace = temporaryDirectory("local-status-commit-edge-");
    const initial = join(workspace, "initial");
    execFileSync("git", ["init", "-b", "main", initial], { stdio: "ignore" });
    configureUser(initial);
    setWorkspaceRoot(workspace);

    await expect(prepareCommit("initial")).rejects.toMatchObject({
      code: "NOTHING_STAGED",
    });
    writeFileSync(join(initial, "README.md"), "# Initial\n");
    git(initial, "add", "README.md");
    const first = await prepareCommit("initial");
    expect(first.unborn).toBe(true);
    await createCommit("initial", {
      message: "Create initial snapshot",
      snapshotId: first.snapshotId,
    });

    git(initial, "checkout", "--detach");
    writeFileSync(join(initial, "README.md"), "# Detached\n");
    git(initial, "add", "README.md");
    const detached = await prepareCommit("initial");
    expect(detached.detached).toBe(true);
    await createCommit("initial", {
      message: "Update detached snapshot",
      snapshotId: detached.snapshotId,
    });
    expect(git(initial, "log", "-1", "--format=%s")).toBe(
      "Update detached snapshot",
    );
  });

  it("surfaces identity, hook, and unresolved-conflict failures", async () => {
    const workspace = temporaryDirectory("local-status-commit-failures-");
    const identity = join(workspace, "identity");
    execFileSync("git", ["init", "-b", "main", identity], { stdio: "ignore" });
    git(identity, "config", "user.useConfigOnly", "true");
    git(identity, "config", "user.name", "");
    git(identity, "config", "user.email", "");
    writeFileSync(join(identity, "identity.txt"), "identity\n");
    git(identity, "add", "identity.txt");
    setWorkspaceRoot(workspace);
    const identityContext = await prepareCommit("identity");
    await expect(
      createCommit("identity", {
        message: "Missing identity",
        snapshotId: identityContext.snapshotId,
      }),
    ).rejects.toThrow(/identity/i);

    configureUser(identity);
    const hookPath = join(identity, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\necho 'Blocked by test hook' >&2\nexit 1\n");
    chmodSync(hookPath, 0o755);
    const hookContext = await prepareCommit("identity");
    await expect(
      createCommit("identity", {
        message: "Blocked commit",
        snapshotId: hookContext.snapshotId,
      }),
    ).rejects.toThrow("Blocked by test hook");

    const conflict = join(workspace, "conflict");
    execFileSync("git", ["init", "-b", "main", conflict], { stdio: "ignore" });
    configureUser(conflict);
    writeFileSync(join(conflict, "shared.txt"), "base\n");
    git(conflict, "add", "shared.txt");
    git(conflict, "commit", "-m", "Base");
    git(conflict, "checkout", "-b", "other");
    writeFileSync(join(conflict, "shared.txt"), "other\n");
    git(conflict, "commit", "-am", "Other");
    git(conflict, "checkout", "main");
    writeFileSync(join(conflict, "shared.txt"), "main\n");
    git(conflict, "commit", "-am", "Main");
    expect(() => git(conflict, "merge", "other")).toThrow();
    setWorkspaceRoot(workspace);
    await expect(prepareCommit("conflict")).rejects.toMatchObject({
      code: "UNRESOLVED_CONFLICTS",
    });
  });

  it("syncs a configured upstream with fast-forward-only pull followed by push", async () => {
    const workspace = temporaryDirectory("local-status-sync-workspace-");
    const remote = temporaryDirectory("local-status-sync-remote-");
    const producer = temporaryDirectory("local-status-sync-producer-");
    const repository = join(workspace, "sync-repo");

    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "base.txt"), "base\n");
    git(repository, "add", "base.txt");
    git(repository, "commit", "-m", "Base");
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "-u", "origin", "main");
    git(remote, "symbolic-ref", "HEAD", "refs/heads/main");

    execFileSync("git", ["clone", remote, producer], { stdio: "ignore" });
    configureUser(producer);
    writeFileSync(join(producer, "incoming.txt"), "from remote\n");
    git(producer, "add", "incoming.txt");
    git(producer, "commit", "-m", "Incoming");
    git(producer, "push", "origin", "main");

    setWorkspaceRoot(workspace);
    await fetchOne("sync-repo");
    const pulled = await syncRepository("sync-repo");
    expect(pulled).toMatchObject({
      repositoryId: "sync-repo",
      pulled: 1,
      pushed: 0,
      incoming: 0,
      outgoing: 0,
    });
    expect(readFileSync(join(repository, "incoming.txt"), "utf8")).toBe(
      "from remote\n",
    );

    writeFileSync(join(repository, "outgoing.txt"), "from local\n");
    git(repository, "add", "outgoing.txt");
    git(repository, "commit", "-m", "Outgoing");
    const pushed = await syncRepository("sync-repo");
    expect(pushed).toMatchObject({ pulled: 0, pushed: 1, incoming: 0, outgoing: 0 });
    git(producer, "pull", "--ff-only");
    expect(readFileSync(join(producer, "outgoing.txt"), "utf8")).toBe("from local\n");
  });

  it("refuses sync without an upstream and refuses divergent implicit merges", async () => {
    const workspace = temporaryDirectory("local-status-sync-safety-");
    const remote = temporaryDirectory("local-status-sync-safety-remote-");
    const producer = temporaryDirectory("local-status-sync-safety-producer-");
    const noUpstream = join(workspace, "no-upstream");
    const repository = join(workspace, "diverged");

    execFileSync("git", ["init", "-b", "main", noUpstream], { stdio: "ignore" });
    configureUser(noUpstream);
    writeFileSync(join(noUpstream, "local.txt"), "local\n");
    git(noUpstream, "add", "local.txt");
    git(noUpstream, "commit", "-m", "Local only");

    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "base.txt"), "base\n");
    git(repository, "add", "base.txt");
    git(repository, "commit", "-m", "Base");
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "-u", "origin", "main");
    git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    execFileSync("git", ["clone", remote, producer], { stdio: "ignore" });
    configureUser(producer);

    writeFileSync(join(repository, "local-change.txt"), "local\n");
    git(repository, "add", "local-change.txt");
    git(repository, "commit", "-m", "Local change");
    writeFileSync(join(producer, "remote-change.txt"), "remote\n");
    git(producer, "add", "remote-change.txt");
    git(producer, "commit", "-m", "Remote change");
    git(producer, "push", "origin", "main");

    setWorkspaceRoot(workspace);
    await expect(syncRepository("no-upstream")).rejects.toMatchObject({
      code: "NO_UPSTREAM",
    });
    await expect(syncRepository("diverged")).rejects.toBeInstanceOf(GitServiceError);
    expect(git(remote, "log", "--format=%s", "-1", "main")).toBe("Remote change");
  });

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
    const archived = await listRepositorySummaries({
      archivedRepositoryIds: ["product-api"],
    });
    expect(archived.repositories[0]).toMatchObject({
      id: "product-api",
      archived: true,
      branch: null,
    });

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

  it("uses the workspace root as the repository when it is a Git root", async () => {
    const repository = temporaryDirectory("local-status-root-repository-");
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    configureUser(repository);
    writeFileSync(join(repository, "tracked.txt"), "workspace root\n");
    git(repository, "add", "tracked.txt");
    git(repository, "commit", "-m", "Workspace root");

    setWorkspaceRoot(repository);
    const result = await listRepositorySummaries();

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toMatchObject({
      id: repository.split("/").pop(),
      branch: "main",
    });
  });

  it("reports unborn/detached child repositories and deduplicates symlinks", async () => {
    const workspace = temporaryDirectory("local-status-discovery-");

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
