import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 60_000;
const SYNC_TIMEOUT_MS = 120_000;
const COMMIT_TIMEOUT_MS = 120_000;
const MAX_GIT_OUTPUT = 12 * 1024 * 1024;
const MAX_COMMIT_DIFF_BYTES = 1_000_000;
const PATH_CHUNK_SIZE = 200;
const MAX_WORKSPACE_FILES = 100_000;
const WORKSPACE_FILE_CACHE_MS = 10_000;
export const MAX_PREVIEW_BYTES = 1_000_000;

const fetchTimes = new Map();
let repositoryCache = { at: 0, root: "", repositories: new Map() };
let workspaceFileCache = { at: 0, root: "", response: null };
let activeWorkspaceRoot = null;

export class GitServiceError extends Error {
  constructor(message, status = 500, code = "GIT_ERROR") {
    super(message);
    this.name = "GitServiceError";
    this.status = status;
    this.code = code;
  }
}

function cleanGitError(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const firstLine = stderr.split("\n").find(Boolean);
  return firstLine?.replace(/^fatal:\s*/i, "") || "Git could not complete the request.";
}

async function execGit(repository, args, options = {}) {
  try {
    const result = await execFileAsync("git", ["-C", repository, ...args], {
      encoding: options.encoding ?? "utf8",
      timeout: options.timeout ?? GIT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? MAX_GIT_OUTPUT,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        ...(options.env ?? {}),
      },
    });
    return result.stdout;
  } catch (error) {
    if (options.allowFailure) return null;
    throw new GitServiceError(cleanGitError(error));
  }
}

function appendLimited(current, chunk, limit) {
  if (current.length >= limit) return { value: current, truncated: true };
  const remaining = limit - current.length;
  if (chunk.length <= remaining) {
    return { value: Buffer.concat([current, chunk]), truncated: false };
  }
  return {
    value: Buffer.concat([current, chunk.subarray(0, remaining)]),
    truncated: true,
  };
}

async function spawnGit(repository, args, options = {}) {
  const stdoutLimit = options.stdoutLimit ?? MAX_GIT_OUTPUT;
  const stderrLimit = options.stderrLimit ?? 64 * 1024;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["-C", repository, ...args], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        ...(options.env ?? {}),
      },
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeout ?? GIT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      const next = appendLimited(stdout, Buffer.from(chunk), stdoutLimit);
      stdout = next.value;
      stdoutTruncated ||= next.truncated;
    });
    child.stderr.on("data", (chunk) => {
      const next = appendLimited(stderr, Buffer.from(chunk), stderrLimit);
      stderr = next.value;
      stderrTruncated ||= next.truncated;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(new GitServiceError(cleanGitError(error)));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdoutText = stdout.toString("utf8");
      const stderrText = stderr.toString("utf8");
      if (timedOut) {
        rejectPromise(
          new GitServiceError(
            "Git did not finish before the operation timed out.",
            408,
            "GIT_TIMEOUT",
          ),
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new GitServiceError(
            cleanGitError({ stderr: stderrText || stdoutText }),
          ),
        );
        return;
      }
      resolvePromise({
        stdout: stdoutText,
        stderr: stderrText,
        stdoutTruncated,
        stderrTruncated,
      });
    });

    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

function workspaceRoot() {
  if (!activeWorkspaceRoot) {
    throw new GitServiceError(
      "Choose a workspace folder to begin.",
      409,
      "WORKSPACE_REQUIRED",
    );
  }
  return activeWorkspaceRoot;
}

export function setWorkspaceRoot(root) {
  activeWorkspaceRoot = root ? resolve(root) : null;
  repositoryCache = { at: 0, root: "", repositories: new Map() };
  workspaceFileCache = { at: 0, root: "", response: null };
  fetchTimes.clear();
}

export function getWorkspaceRoot() {
  return activeWorkspaceRoot;
}

async function isDirectGitRoot(directory) {
  const topLevel = await execGit(directory, ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
  });
  if (!topLevel) return false;
  try {
    return (await realpath(topLevel.trim())) === (await realpath(directory));
  } catch {
    return false;
  }
}

function normalizeRemoteUrl(value) {
  return value.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
}

function repositoryNameFromRemote(remote, fallback) {
  if (!remote) return fallback;
  const normalized = remote.replace(/\\/g, "/");
  const tail = normalized.split(/[/:]/).filter(Boolean).at(-1);
  return tail || fallback;
}

async function repositoryIdentity(repository) {
  const [originOutput, commonOutput, gitDirOutput] = await Promise.all([
    execGit(repository.path, ["config", "--get", "remote.origin.url"], {
      allowFailure: true,
    }),
    execGit(repository.path, ["rev-parse", "--git-common-dir"], {
      allowFailure: true,
    }),
    execGit(repository.path, ["rev-parse", "--git-dir"], {
      allowFailure: true,
    }),
  ]);
  const remoteIdentity = originOutput?.trim()
    ? normalizeRemoteUrl(originOutput)
    : null;
  const commonCandidate = commonOutput?.trim() || ".git";
  const gitDirCandidate = gitDirOutput?.trim() || ".git";
  const commonDirectory = await realpath(
    isAbsolute(commonCandidate)
      ? commonCandidate
      : resolve(repository.path, commonCandidate),
  ).catch(() =>
    resolve(repository.path, commonCandidate),
  );
  const gitDirectory = await realpath(
    isAbsolute(gitDirCandidate)
      ? gitDirCandidate
      : resolve(repository.path, gitDirCandidate),
  ).catch(() =>
    resolve(repository.path, gitDirCandidate),
  );
  // The Git common directory is shared only by a repository and its linked
  // worktrees. Remote URLs are deliberately not used here: independent clones
  // are separate working repositories and must remain independently favouritable.
  const groupIdentity = `common:${commonDirectory}`;
  return {
    groupId: createHash("sha256").update(groupIdentity).digest("hex").slice(0, 20),
    groupName: repositoryNameFromRemote(remoteIdentity, repository.id),
    remoteIdentity,
    isPrimaryWorktree: gitDirectory === commonDirectory,
  };
}

export async function discoverRepositories({ refresh = false } = {}) {
  const root = workspaceRoot();
  if (
    !refresh &&
    repositoryCache.root === root &&
    Date.now() - repositoryCache.at < 2_000
  ) {
    return repositoryCache.repositories;
  }
  const cachedRepositories =
    repositoryCache.root === root
      ? repositoryCache.repositories
      : new Map();

  const entries = await readdir(root, { withFileTypes: true });
  const candidates = (
    await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry) => {
          const childPath = join(root, entry.name);
          if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;
          try {
            if (!(await stat(childPath)).isDirectory()) return null;
            return {
              id: entry.name,
              path: await realpath(childPath),
            };
          } catch {
            return null;
          }
        }),
    )
  ).filter(Boolean);
  const checks = await Promise.all(
    candidates.map(async (candidate) => {
      const cached = cachedRepositories.get(candidate.id);
      return {
        ...candidate,
        cached: cached?.path === candidate.path ? cached : null,
        valid:
          cached?.path === candidate.path
            ? true
            : await isDirectGitRoot(candidate.path),
      };
    }),
  );
  const seenPaths = new Set();
  const repositories = new Map();
  for (const candidate of checks.filter((entry) => entry.valid)) {
    if (seenPaths.has(candidate.path)) continue;
    seenPaths.add(candidate.path);
    const identity = candidate.cached
      ? {
          groupId: candidate.cached.groupId,
          groupName: candidate.cached.groupName,
          remoteIdentity: candidate.cached.remoteIdentity,
          isPrimaryWorktree: candidate.cached.isPrimaryWorktree,
        }
      : await repositoryIdentity(candidate);
    repositories.set(candidate.id, {
      id: candidate.id,
      path: candidate.path,
      ...identity,
    });
  }
  repositoryCache = { at: Date.now(), root, repositories };
  return repositories;
}

export async function getRepository(repositoryId) {
  if (
    !repositoryId ||
    repositoryId.includes("/") ||
    repositoryId.includes("\\") ||
    repositoryId === "." ||
    repositoryId === ".."
  ) {
    throw new GitServiceError("Repository not found.", 404, "REPOSITORY_NOT_FOUND");
  }
  const repositories = await discoverRepositories();
  const repository = repositories.get(repositoryId);
  if (!repository) {
    throw new GitServiceError("Repository not found.", 404, "REPOSITORY_NOT_FOUND");
  }
  return repository;
}

function parseBranchHeader(record, branch) {
  if (record.startsWith("# branch.oid ")) branch.oid = record.slice(13);
  if (record.startsWith("# branch.head ")) branch.head = record.slice(14);
  if (record.startsWith("# branch.upstream ")) branch.upstream = record.slice(18);
  if (record.startsWith("# branch.ab ")) {
    const match = record.match(/\+(\d+)\s+-(\d+)/);
    branch.ahead = Number(match?.[1] ?? 0);
    branch.behind = Number(match?.[2] ?? 0);
  }
}

function changeKind(code) {
  return {
    A: "added",
    C: "copied",
    D: "deleted",
    M: "modified",
    R: "renamed",
    T: "type-changed",
    U: "conflict",
  }[code] ?? "modified";
}

function parseOrdinary(record) {
  const match = record.match(
    /^1 (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/,
  );
  if (!match) return null;
  return { xy: match[1], path: match[8], previousPath: null };
}

function parseRename(record, previousPath) {
  const match = record.match(
    /^2 (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/,
  );
  if (!match) return null;
  return { xy: match[1], path: match[9], previousPath };
}

function addScopedChanges(changes, entry) {
  const [indexCode, workingCode] = entry.xy;
  if (indexCode && indexCode !== ".") {
    changes.push({
      id: `staged:${entry.path}`,
      path: entry.path,
      previousPath: entry.previousPath,
      scope: "staged",
      kind: changeKind(indexCode),
      status: indexCode,
    });
  }
  if (workingCode && workingCode !== ".") {
    changes.push({
      id: `working:${entry.path}`,
      path: entry.path,
      previousPath: entry.previousPath,
      scope: "working",
      kind: changeKind(workingCode),
      status: workingCode,
    });
  }
}

export function parsePorcelainV2(output) {
  const records = output.split("\0");
  const branch = {
    oid: null,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
  };
  const changes = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# ")) {
      parseBranchHeader(record, branch);
      continue;
    }
    if (record.startsWith("1 ")) {
      const entry = parseOrdinary(record);
      if (entry) addScopedChanges(changes, entry);
      continue;
    }
    if (record.startsWith("2 ")) {
      const previousPath = records[index + 1] || null;
      index += 1;
      const entry = parseRename(record, previousPath);
      if (entry) addScopedChanges(changes, entry);
      continue;
    }
    if (record.startsWith("u ")) {
      const match = record.match(
        /^u (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/,
      );
      if (match) {
        changes.push({
          id: `conflict:${match[10]}`,
          path: match[10],
          previousPath: null,
          scope: "conflict",
          kind: "conflict",
          status: match[1],
        });
      }
      continue;
    }
    if (record.startsWith("? ")) {
      const path = record.slice(2);
      changes.push({
        id: `untracked:${path}`,
        path,
        previousPath: null,
        scope: "untracked",
        kind: "untracked",
        status: "?",
      });
    }
  }

  return { branch, changes };
}

async function latestCommit(repositoryPath) {
  const output = await execGit(
    repositoryPath,
    ["log", "-1", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"],
    { allowFailure: true },
  );
  if (!output?.trim()) return null;
  const [sha, shortSha, author, authoredAt, subject] = output.trim().split("\x1f");
  return { sha, shortSha, author, authoredAt, subject };
}

function summarizeChanges(changes) {
  const unique = new Set(changes.map((change) => change.path));
  return {
    files: unique.size,
    staged: changes.filter((change) => change.scope === "staged").length,
    modified: changes.filter((change) => change.scope === "working").length,
    untracked: changes.filter((change) => change.scope === "untracked").length,
    conflicts: changes.filter((change) => change.scope === "conflict").length,
  };
}

export async function repositoryStatus(repository) {
  const output = await execGit(repository.path, [
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
  ]);
  const parsed = parsePorcelainV2(output);
  const commit = await latestCommit(repository.path);
  const summary = summarizeChanges(parsed.changes);
  return {
    id: repository.id,
    groupId: repository.groupId,
    groupName: repository.groupName,
    remoteIdentity: repository.remoteIdentity,
    isPrimaryWorktree: repository.isPrimaryWorktree,
    branch: parsed.branch.head === "(detached)" ? null : parsed.branch.head || null,
    detached: parsed.branch.head === "(detached)",
    unborn:
      parsed.branch.oid === "(initial)" ||
      parsed.branch.oid === "0000000000000000000000000000000000000000",
    headSha: commit?.sha ?? null,
    upstream: parsed.branch.upstream,
    incoming: parsed.branch.behind,
    outgoing: parsed.branch.ahead,
    summary,
    latestCommit: commit,
    fetchedAt: fetchTimes.get(repository.id) ?? null,
    scannedAt: new Date().toISOString(),
    error: null,
  };
}

export async function listRepositorySummaries({ archivedGroupIds = [] } = {}) {
  const repositories = await discoverRepositories({ refresh: true });
  const archivedGroups = new Set(archivedGroupIds);
  const summaries = await Promise.all(
    [...repositories.values()].map(async (repository) => {
      if (archivedGroups.has(repository.groupId)) {
        return {
          id: repository.id,
          groupId: repository.groupId,
          groupName: repository.groupName,
          remoteIdentity: repository.remoteIdentity,
          isPrimaryWorktree: repository.isPrimaryWorktree,
          archived: true,
          branch: null,
          detached: false,
          unborn: false,
          headSha: null,
          upstream: null,
          incoming: 0,
          outgoing: 0,
          summary: { files: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 },
          latestCommit: null,
          fetchedAt: fetchTimes.get(repository.id) ?? null,
          scannedAt: new Date().toISOString(),
          error: null,
        };
      }
      try {
        return { ...(await repositoryStatus(repository)), archived: false };
      } catch (error) {
        return {
          id: repository.id,
          groupId: repository.groupId,
          groupName: repository.groupName,
          remoteIdentity: repository.remoteIdentity,
          isPrimaryWorktree: repository.isPrimaryWorktree,
          archived: false,
          branch: null,
          detached: false,
          unborn: false,
          headSha: null,
          upstream: null,
          incoming: 0,
          outgoing: 0,
          summary: { files: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 },
          latestCommit: null,
          fetchedAt: fetchTimes.get(repository.id) ?? null,
          scannedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Repository scan failed.",
        };
      }
    }),
  );
  return {
    generatedAt: new Date().toISOString(),
    workspaceName: basename(workspaceRoot()),
    repositories: summaries.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function repositoryChanges(repositoryId) {
  const repository = await getRepository(repositoryId);
  const output = await execGit(repository.path, [
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
  ]);
  const parsed = parsePorcelainV2(output);
  const order = { conflict: 0, staged: 1, working: 2, untracked: 3 };
  return {
    repositoryId,
    changes: parsed.changes.sort(
      (left, right) =>
        order[left.scope] - order[right.scope] || left.path.localeCompare(right.path),
    ),
  };
}

export async function repositoryBranches(repositoryId) {
  const repository = await getRepository(repositoryId);
  const output = await execGit(repository.path, [
    "for-each-ref",
    "--format=%(refname)%09%(refname:short)%09%(HEAD)",
    "refs/heads",
    "refs/remotes",
  ]);
  const local = [];
  const remote = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [ref, name, headMarker] = line.split("\t");
    if (!ref || !name || ref.endsWith("/HEAD")) continue;
    const entry = {
      name,
      ref,
      remote: ref.startsWith("refs/remotes/"),
      current: headMarker?.trim() === "*",
    };
    (entry.remote ? remote : local).push(entry);
  }
  const order = (left, right) =>
    Number(right.current) - Number(left.current) ||
    left.name.localeCompare(right.name);
  return {
    repositoryId,
    local: local.sort(order),
    remote: remote.sort(order),
  };
}

async function repositoryIsDirty(repository) {
  const output = await execGit(repository.path, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  return Boolean(output.trim());
}

export async function switchRepositoryBranch(
  repositoryId,
  targetRef,
  { stashChanges = false } = {},
) {
  const repository = await getRepository(repositoryId);
  const branches = await repositoryBranches(repositoryId);
  const target = [...branches.local, ...branches.remote].find(
    (entry) => entry.ref === targetRef,
  );
  if (!target) {
    throw new GitServiceError("That branch is no longer available.", 404, "BRANCH_NOT_FOUND");
  }
  const dirty = await repositoryIsDirty(repository);
  if (dirty && !stashChanges) {
    return { repositoryId, requiresStash: true, cancelled: false };
  }

  let stashed = null;
  if (dirty) {
    const current = (await repositoryStatus(repository)).branch || "detached HEAD";
    const message = `Local Status: ${current} → ${target.name}`;
    await execGit(repository.path, [
      "stash",
      "push",
      "--include-untracked",
      "--message",
      message,
    ]);
    stashed = { ref: "stash@{0}", message };
  }

  if (target.remote) {
    const remoteName = target.name.split("/").slice(1).join("/");
    const matchingLocal = branches.local.find((entry) => entry.name === remoteName);
    if (matchingLocal) {
      await execGit(repository.path, ["switch", matchingLocal.name]);
    } else {
      await execGit(repository.path, ["switch", "--track", target.name]);
    }
  } else {
    await execGit(repository.path, ["switch", target.name]);
  }

  return {
    repositoryId,
    requiresStash: false,
    cancelled: false,
    stashed,
    repository: await repositoryStatus(repository),
  };
}

function stashSourceBranch(message) {
  const localStatus = message.match(/^Local Status:\s+(.+?)\s+→/);
  if (localStatus) return localStatus[1];
  const standard = message.match(/^(?:WIP on|On)\s+([^:]+):/);
  return standard?.[1] ?? null;
}

export async function repositoryStashes(repositoryId) {
  const repository = await getRepository(repositoryId);
  const output = await execGit(
    repository.path,
    ["stash", "list", "--format=%gd%x1f%gs%x1f%ci"],
    { allowFailure: true },
  );
  const stashes = (output ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, message = "", createdAt = ""] = line.split("\x1f");
      return {
        ref,
        index: Number(ref.match(/\{(\d+)\}/)?.[1] ?? 0),
        message,
        branch: stashSourceBranch(message),
        createdAt,
      };
    });
  return { repositoryId, stashes };
}

export async function applyRepositoryStash(repositoryId, stashRef, mode) {
  const repository = await getRepository(repositoryId);
  const stashes = await repositoryStashes(repositoryId);
  if (!stashes.stashes.some((stash) => stash.ref === stashRef)) {
    throw new GitServiceError("That stash is no longer available.", 404, "STASH_NOT_FOUND");
  }
  if (!["apply", "pop"].includes(mode)) {
    throw new GitServiceError("Invalid stash action.", 400, "INVALID_STASH_ACTION");
  }
  await execGit(repository.path, ["stash", mode, "--index", stashRef]);
  return {
    repositoryId,
    mode,
    stashRef,
    changes: (await repositoryChanges(repositoryId)).changes,
    stashes: (await repositoryStashes(repositoryId)).stashes,
  };
}

const actionableScopes = new Set([
  "conflict",
  "staged",
  "working",
  "untracked",
  "unstaged",
]);

function selectedChanges(repositoryPath, changes, selection, allowedScopes) {
  const scope = selection?.scope;
  if (!actionableScopes.has(scope) || !allowedScopes.has(scope)) {
    throw new GitServiceError("This change action is not available.", 400, "INVALID_CHANGE_ACTION");
  }
  const scoped =
    scope === "unstaged"
      ? changes.filter(
          (change) => change.scope === "working" || change.scope === "untracked",
        )
      : changes.filter((change) => change.scope === scope);
  if (selection.path === undefined || selection.path === null) return scoped;
  const { normalizedPath } = safeRepoPath(repositoryPath, selection.path);
  const match = scoped.find((change) => change.path === normalizedPath);
  if (!match) {
    throw new GitServiceError(
      "This file has changed since the view was refreshed.",
      409,
      "STALE_CHANGE",
    );
  }
  return [match];
}

function pathsForChanges(changes) {
  return [
    ...new Set(
      changes.flatMap((change) =>
        change.previousPath ? [change.path, change.previousPath] : [change.path],
      ),
    ),
  ];
}

async function execGitPathChunks(repositoryPath, prefix, paths) {
  for (let index = 0; index < paths.length; index += PATH_CHUNK_SIZE) {
    await execGit(repositoryPath, [
      ...prefix,
      "--",
      ...paths.slice(index, index + PATH_CHUNK_SIZE),
    ]);
  }
}

async function currentChanges(repository) {
  const output = await execGit(repository.path, [
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
  ]);
  return parsePorcelainV2(output).changes;
}

function commitSnapshotId(rawIndex) {
  return createHash("sha256").update(rawIndex).digest("hex");
}

function stagedFiles(changes) {
  return changes
    .filter((change) => change.scope === "staged")
    .map(({ path, previousPath, kind, status }) => ({
      path,
      previousPath,
      kind,
      status,
    }));
}

async function currentCommitContext(repository) {
  const changes = await currentChanges(repository);
  if (changes.some((change) => change.scope === "conflict")) {
    throw new GitServiceError(
      "Resolve all conflicts before committing.",
      409,
      "UNRESOLVED_CONFLICTS",
    );
  }
  const files = stagedFiles(changes);
  if (!files.length) {
    throw new GitServiceError(
      "Stage at least one change before committing.",
      409,
      "NOTHING_STAGED",
    );
  }
  const rawIndex = await execGit(repository.path, [
    "diff",
    "--cached",
    "--raw",
    "-z",
    "--no-ext-diff",
  ]);
  const status = await repositoryStatus(repository);
  return {
    repositoryId: repository.id,
    snapshotId: commitSnapshotId(rawIndex),
    branch: status.branch,
    detached: status.detached,
    unborn: status.unborn,
    stagedFiles: files,
  };
}

function assertCommitSnapshot(context, expectedSnapshotId) {
  if (
    typeof expectedSnapshotId !== "string" ||
    expectedSnapshotId.length !== 64 ||
    expectedSnapshotId !== context.snapshotId
  ) {
    throw new GitServiceError(
      "The staged changes changed while the commit window was open. Review them and try again.",
      409,
      "STAGED_CHANGES_CHANGED",
    );
  }
}

export async function prepareCommit(repositoryId) {
  return currentCommitContext(await getRepository(repositoryId));
}

export async function commitMessageContext(repositoryId, expectedSnapshotId) {
  const repository = await getRepository(repositoryId);
  const context = await currentCommitContext(repository);
  assertCommitSnapshot(context, expectedSnapshotId);
  const [statistics, recentSubjects, patch] = await Promise.all([
    execGit(
      repository.path,
      ["diff", "--cached", "--stat", "--no-ext-diff", "--no-color"],
      { allowFailure: true },
    ),
    execGit(
      repository.path,
      ["log", "--max-count=10", "--format=%s"],
      { allowFailure: true },
    ),
    spawnGit(
      repository.path,
      ["diff", "--cached", "--no-ext-diff", "--no-color", "--unified=3"],
      { stdoutLimit: MAX_COMMIT_DIFF_BYTES },
    ),
  ]);
  return {
    ...context,
    statistics: statistics?.trim() ?? "",
    recentSubjects: (recentSubjects ?? "")
      .split("\n")
      .map((subject) => subject.trim())
      .filter(Boolean),
    patch: patch.stdout,
    patchTruncated: patch.stdoutTruncated,
  };
}

export async function createCommit(repositoryId, input) {
  const repository = await getRepository(repositoryId);
  const message =
    typeof input?.message === "string" ? input.message.trim() : "";
  if (!message || message.length > 20_000 || message.includes("\0")) {
    throw new GitServiceError(
      "Enter a commit message between 1 and 20,000 characters.",
      400,
      "INVALID_COMMIT_MESSAGE",
    );
  }
  const context = await currentCommitContext(repository);
  assertCommitSnapshot(context, input?.snapshotId);
  await spawnGit(
    repository.path,
    ["commit", "--cleanup=strip", "--file=-"],
    {
      input: `${message}\n`,
      timeout: COMMIT_TIMEOUT_MS,
      env: { GIT_EDITOR: "true" },
    },
  );
  const commit = await latestCommit(repository.path);
  if (!commit) {
    throw new GitServiceError(
      "Git created the commit but its details could not be read.",
    );
  }
  return {
    repositoryId,
    commit,
    changes: (await repositoryChanges(repositoryId)).changes,
  };
}

export async function stageChanges(repositoryId, selection) {
  const repository = await getRepository(repositoryId);
  const changes = selectedChanges(
    repository.path,
    await currentChanges(repository),
    selection,
    new Set(["conflict", "working", "untracked", "unstaged"]),
  );
  if (changes.length) {
    await execGitPathChunks(repository.path, ["add", "-A"], pathsForChanges(changes));
  }
  return repositoryChanges(repositoryId);
}

export async function unstageChanges(repositoryId, selection) {
  const repository = await getRepository(repositoryId);
  const changes = selectedChanges(
    repository.path,
    await currentChanges(repository),
    selection,
    new Set(["staged"]),
  );
  const paths = pathsForChanges(changes);
  if (!paths.length) return repositoryChanges(repositoryId);

  const hasHead = Boolean(
    await execGit(repository.path, ["rev-parse", "--verify", "HEAD"], {
      allowFailure: true,
    }),
  );
  await execGitPathChunks(
    repository.path,
    hasHead
      ? ["reset", "--quiet", "HEAD"]
      : ["rm", "--cached", "-r", "--ignore-unmatch"],
    paths,
  );
  return repositoryChanges(repositoryId);
}

async function removeUntrackedFile(repositoryPath, filePath) {
  const { absolutePath } = safeRepoPath(repositoryPath, filePath);
  let details;
  try {
    details = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (details.isDirectory() && !details.isSymbolicLink()) {
    throw new GitServiceError(
      "Local Status will not recursively remove an untracked directory.",
      409,
      "UNTRACKED_DIRECTORY",
    );
  }
  await unlink(absolutePath);
}

async function revertWorkingChange(repositoryPath, change) {
  if (!change.previousPath) {
    await execGitPathChunks(repositoryPath, ["restore", "--worktree"], [change.path]);
    return;
  }

  await execGitPathChunks(
    repositoryPath,
    ["restore", "--worktree"],
    [change.previousPath],
  );
  const destinationIsTracked = Boolean(
    await execGit(repositoryPath, ["ls-files", "--error-unmatch", "--", change.path], {
      allowFailure: true,
    }),
  );
  if (destinationIsTracked) {
    await execGitPathChunks(repositoryPath, ["restore", "--worktree"], [change.path]);
  } else {
    await removeUntrackedFile(repositoryPath, change.path);
  }
}

export async function revertChanges(repositoryId, selection) {
  const repository = await getRepository(repositoryId);
  const changes = selectedChanges(
    repository.path,
    await currentChanges(repository),
    selection,
    new Set(["working", "untracked", "unstaged"]),
  );
  for (const change of changes) {
    if (change.scope === "untracked") {
      await removeUntrackedFile(repository.path, change.path);
    } else {
      await revertWorkingChange(repository.path, change);
    }
  }
  return repositoryChanges(repositoryId);
}

function parseCommits(output) {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, shortSha, author, authoredAt, subject, refs] = record.split("\x1f");
      return { sha, shortSha, author, authoredAt, subject, refs: refs || "" };
    });
}

export async function repositoryCommits(repositoryId, scope = "local", limit = 60) {
  const repository = await getRepository(repositoryId);
  const range =
    scope === "incoming"
      ? "HEAD..@{upstream}"
      : scope === "outgoing"
        ? "@{upstream}..HEAD"
        : "HEAD";
  const output = await execGit(
    repository.path,
    [
      "log",
      range,
      `--max-count=${Math.min(Math.max(limit, 1), 200)}`,
      "--date=iso-strict",
      "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D%x1e",
    ],
    { allowFailure: true },
  );
  return { repositoryId, scope, commits: output ? parseCommits(output) : [] };
}

function parseNameStatus(output) {
  const records = output.split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index];
    if (/^[RC]/.test(status)) {
      files.push({
        status: status[0],
        previousPath: records[index + 1],
        path: records[index + 2],
      });
      index += 2;
    } else {
      files.push({ status: status[0], previousPath: null, path: records[index + 1] });
      index += 1;
    }
  }
  return files.filter((file) => file.path);
}

export async function commitDetails(repositoryId, sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new GitServiceError("Commit not found.", 404, "COMMIT_NOT_FOUND");
  }
  const repository = await getRepository(repositoryId);
  const metadata = await execGit(
    repository.path,
    ["show", "-s", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b", sha],
    { allowFailure: true },
  );
  if (!metadata) {
    throw new GitServiceError("Commit not found.", 404, "COMMIT_NOT_FOUND");
  }
  const [fullSha, shortSha, author, authoredAt, subject, body] = metadata.trim().split("\x1f");
  const fileOutput = await execGit(repository.path, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-M",
    "-z",
    sha,
  ]);
  return {
    repositoryId,
    commit: { sha: fullSha, shortSha, author, authoredAt, subject, body: body || "" },
    files: parseNameStatus(fileOutput),
  };
}

async function filesForRepository(repository, limit = Number.POSITIVE_INFINITY) {
  const output = await execGit(repository.path, [
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z",
  ]);
  const files = [...new Set(output.split("\0").filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  return files.slice(0, limit);
}

export async function repositoryFiles(repositoryId) {
  const repository = await getRepository(repositoryId);
  const files = await filesForRepository(repository);
  return { repositoryId, files };
}

export async function workspaceFiles() {
  const root = workspaceRoot();
  if (
    workspaceFileCache.response &&
    workspaceFileCache.root === root &&
    Date.now() - workspaceFileCache.at < WORKSPACE_FILE_CACHE_MS
  ) {
    return workspaceFileCache.response;
  }

  const repositories = await discoverRepositories();
  const results = await Promise.all(
    [...repositories.values()].map(async (repository) => {
      try {
        const files = await filesForRepository(
          repository,
          MAX_WORKSPACE_FILES + 1,
        );
        return {
          repositoryId: repository.id,
          files: files.slice(0, MAX_WORKSPACE_FILES),
          truncated: files.length > MAX_WORKSPACE_FILES,
          error: null,
        };
      } catch (error) {
        return {
          repositoryId: repository.id,
          files: [],
          truncated: false,
          error:
            error instanceof Error ? error.message : "Could not index this repository.",
        };
      }
    }),
  );
  const files = results
    .flatMap((result) =>
      result.files.map((path) => ({ repositoryId: result.repositoryId, path })),
    )
    .sort(
      (left, right) =>
        left.repositoryId.localeCompare(right.repositoryId) ||
        left.path.localeCompare(right.path),
    );
  const truncated =
    files.length > MAX_WORKSPACE_FILES ||
    results.some((result) => result.truncated);
  const response = {
    generatedAt: new Date().toISOString(),
    files: files.slice(0, MAX_WORKSPACE_FILES),
    errors: results
      .filter((result) => result.error)
      .map((result) => ({
        repositoryId: result.repositoryId,
        error: result.error,
      })),
    truncated,
  };
  workspaceFileCache = { at: Date.now(), root, response };
  return response;
}

function safeRepoPath(repositoryPath, filePath) {
  if (!filePath || isAbsolute(filePath) || filePath.includes("\0")) {
    throw new GitServiceError("File not found.", 404, "FILE_NOT_FOUND");
  }
  const normalizedPath = normalize(filePath).replaceAll("\\", "/");
  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../")
  ) {
    throw new GitServiceError("File not found.", 404, "FILE_NOT_FOUND");
  }
  const absolutePath = resolve(repositoryPath, normalizedPath);
  const pathFromRoot = relative(repositoryPath, absolutePath);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new GitServiceError("File not found.", 404, "FILE_NOT_FOUND");
  }
  return { normalizedPath, absolutePath };
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  return sample.includes(0);
}

function textPayload(buffer, source, label) {
  if (buffer === null) {
    return { content: "", source, label, binary: false, truncated: false, missing: true };
  }
  if (isBinary(buffer)) {
    return { content: "", source, label, binary: true, truncated: false, missing: false };
  }
  const truncated = buffer.length > MAX_PREVIEW_BYTES;
  return {
    content: buffer.subarray(0, MAX_PREVIEW_BYTES).toString("utf8"),
    source,
    label,
    binary: false,
    truncated,
    missing: false,
  };
}

async function readWorkingFile(repositoryPath, filePath, label) {
  const { absolutePath } = safeRepoPath(repositoryPath, filePath);
  try {
    const details = await lstat(absolutePath);
    if (details.isSymbolicLink()) {
      return textPayload(Buffer.from(await readlink(absolutePath)), "working", label);
    }
    if (!details.isFile()) return textPayload(null, "working", label);
    return textPayload(await readFile(absolutePath), "working", label);
  } catch (error) {
    if (error?.code === "ENOENT") return textPayload(null, "working", label);
    throw error;
  }
}

async function readGitObject(repositoryPath, spec, source, label) {
  const sizeOutput = await execGit(repositoryPath, ["cat-file", "-s", spec], {
    allowFailure: true,
  });
  if (sizeOutput === null) return textPayload(null, source, label);
  const size = Number(sizeOutput.trim());
  if (size > MAX_PREVIEW_BYTES) {
    const preview = await execGit(repositoryPath, ["show", spec], {
      allowFailure: true,
      encoding: "buffer",
      maxBuffer: Math.min(size + 1024, MAX_PREVIEW_BYTES + 256_000),
    });
    if (preview === null) {
      return { ...textPayload(Buffer.alloc(0), source, label), truncated: true };
    }
    return { ...textPayload(Buffer.from(preview), source, label), truncated: true };
  }
  const output = await execGit(repositoryPath, ["show", spec], {
    allowFailure: true,
    encoding: "buffer",
    maxBuffer: MAX_PREVIEW_BYTES + 256_000,
  });
  if (output === null) return textPayload(null, source, label);
  return textPayload(Buffer.isBuffer(output) ? output : Buffer.from(output), source, label);
}

const languageByExtension = {
  ".css": "css",
  ".go": "go",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".md": "markdown",
  ".mjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".sh": "shell",
  ".sql": "sql",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function languageForPath(filePath) {
  const fileName = basename(filePath).toLowerCase();
  if (fileName === "dockerfile") return "dockerfile";
  if (fileName === "makefile") return "makefile";
  return languageByExtension[extname(fileName)] ?? "plaintext";
}

export async function comparisonContents(repositoryId, options) {
  const repository = await getRepository(repositoryId);
  const { normalizedPath: filePath } = safeRepoPath(repository.path, options.path);
  const previousPath = options.previousPath
    ? safeRepoPath(repository.path, options.previousPath).normalizedPath
    : filePath;
  let original;
  let modified;

  if (options.scope === "staged") {
    original = await readGitObject(repository.path, `HEAD:${previousPath}`, "head", "HEAD");
    modified = await readGitObject(repository.path, `:${filePath}`, "index", "Index");
  } else if (options.scope === "untracked") {
    original = textPayload(null, "empty", "New file");
    modified = await readWorkingFile(repository.path, filePath, "Working tree");
  } else if (options.scope === "conflict") {
    original = await readGitObject(repository.path, `:1:${filePath}`, "base", "Merge base");
    modified = await readWorkingFile(repository.path, filePath, "Working tree · unresolved");
  } else if (options.scope === "commit") {
    if (!/^[0-9a-f]{7,40}$/i.test(options.commit || "")) {
      throw new GitServiceError("Commit not found.", 404, "COMMIT_NOT_FOUND");
    }
    original = await readGitObject(
      repository.path,
      `${options.commit}^:${previousPath}`,
      "parent",
      `${options.commit.slice(0, 7)}^`,
    );
    modified = await readGitObject(
      repository.path,
      `${options.commit}:${filePath}`,
      "commit",
      options.commit.slice(0, 7),
    );
  } else {
    original = await readGitObject(repository.path, `:${previousPath}`, "index", "Index");
    modified = await readWorkingFile(repository.path, filePath, "Working tree");
  }

  return {
    repositoryId,
    path: filePath,
    previousPath: previousPath === filePath ? null : previousPath,
    language: languageForPath(filePath),
    original,
    modified,
  };
}

async function fetchRepository(repository) {
  const branch = (await execGit(repository.path, ["branch", "--show-current"], {
    allowFailure: true,
  }))?.trim();
  let remote = branch
    ? (
        await execGit(repository.path, ["config", "--get", `branch.${branch}.remote`], {
          allowFailure: true,
        })
      )?.trim()
    : null;
  if (!remote || remote === ".") {
    const remotes = (
      (await execGit(repository.path, ["remote"], { allowFailure: true })) || ""
    )
      .split("\n")
      .filter(Boolean);
    remote = remotes.includes("origin") ? "origin" : remotes[0];
  }
  if (!remote) {
    throw new GitServiceError("No remote is configured for this repository.", 409, "NO_REMOTE");
  }
  await execGit(repository.path, ["fetch", "--prune", "--no-tags", remote], {
    timeout: FETCH_TIMEOUT_MS,
  });
  const fetchedAt = new Date().toISOString();
  fetchTimes.set(repository.id, fetchedAt);
  return { repositoryId: repository.id, remote, fetchedAt };
}

export async function fetchOne(repositoryId) {
  return fetchRepository(await getRepository(repositoryId));
}

export async function syncRepository(repositoryId) {
  const repository = await getRepository(repositoryId);
  const before = await repositoryStatus(repository);
  if (!before.upstream || !before.branch || before.detached || before.unborn) {
    throw new GitServiceError(
      "Configure an upstream branch before syncing this repository.",
      409,
      "NO_UPSTREAM",
    );
  }

  const remote = (
    await execGit(
      repository.path,
      ["config", "--get", `branch.${before.branch}.remote`],
      { allowFailure: true },
    )
  )?.trim();
  const mergeRef = (
    await execGit(
      repository.path,
      ["config", "--get", `branch.${before.branch}.merge`],
      { allowFailure: true },
    )
  )?.trim();
  if (!remote || remote === "." || !mergeRef?.startsWith("refs/heads/")) {
    throw new GitServiceError(
      "The configured upstream cannot be synchronized.",
      409,
      "INVALID_UPSTREAM",
    );
  }

  await execGit(
    repository.path,
    ["pull", "--no-rebase", "--ff-only", "--no-edit"],
    { timeout: SYNC_TIMEOUT_MS },
  );
  fetchTimes.set(repository.id, new Date().toISOString());
  await execGit(
    repository.path,
    ["push", remote, `HEAD:${mergeRef}`],
    { timeout: SYNC_TIMEOUT_MS },
  );
  const after = await repositoryStatus(repository);
  return {
    repositoryId,
    upstream: before.upstream,
    pulled: before.incoming,
    pushed: before.outgoing,
    incoming: after.incoming,
    outgoing: after.outgoing,
    syncedAt: new Date().toISOString(),
  };
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await callback(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export async function fetchAll({ excludeGroupIds = [] } = {}) {
  const excludedGroups = new Set(excludeGroupIds);
  const repositories = [...(await discoverRepositories({ refresh: true })).values()];
  const activeRepositories = repositories.filter(
    (repository) => !excludedGroups.has(repository.groupId),
  );
  const results = await mapWithConcurrency(activeRepositories, 3, async (repository) => {
    try {
      return { ok: true, ...(await fetchRepository(repository)) };
    } catch (error) {
      return {
        ok: false,
        repositoryId: repository.id,
        error: error instanceof Error ? error.message : "Fetch failed.",
      };
    }
  });
  return { fetchedAt: new Date().toISOString(), results };
}

export async function localListeners() {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 2_000_000 },
    );
    const listeners = [];
    let processName = "unknown";
    let processId = null;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) processId = Number(line.slice(1)) || null;
      if (line.startsWith("c")) processName = line.slice(1) || "unknown";
      if (!line.startsWith("n")) continue;
      const address = line.slice(1);
      const match = address.match(/:(\d+)$/);
      if (!match) continue;
      listeners.push({
        process: processName,
        pid: processId,
        port: Number(match[1]),
        address,
      });
    }
    const unique = new Map(
      listeners.map((listener) => [`${listener.process}:${listener.address}`, listener]),
    );
    return {
      generatedAt: new Date().toISOString(),
      listeners: [...unique.values()].sort(
        (left, right) =>
          left.port - right.port || left.process.localeCompare(right.process),
      ),
    };
  } catch {
    throw new GitServiceError(
      "Local listener scan is unavailable.",
      503,
      "LISTENER_SCAN_UNAVAILABLE",
    );
  }
}

export const __testing = { safeRepoPath, summarizeChanges };
