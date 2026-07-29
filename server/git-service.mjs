import { execFile } from "node:child_process";
import { lstat, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
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
const MAX_GIT_OUTPUT = 12 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 1_000_000;

const fetchTimes = new Map();
let repositoryCache = { at: 0, root: "", repositories: new Map() };
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
    });
    return result.stdout;
  } catch (error) {
    if (options.allowFailure) return null;
    throw new GitServiceError(cleanGitError(error));
  }
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

export async function discoverRepositories({ refresh = false } = {}) {
  const root = workspaceRoot();
  if (
    !refresh &&
    repositoryCache.root === root &&
    Date.now() - repositoryCache.at < 2_000
  ) {
    return repositoryCache.repositories;
  }

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
    candidates.map(async (candidate) => ({
      ...candidate,
      valid: await isDirectGitRoot(candidate.path),
    })),
  );
  const seenPaths = new Set();
  const repositories = new Map();
  for (const candidate of checks.filter((entry) => entry.valid)) {
    if (seenPaths.has(candidate.path)) continue;
    seenPaths.add(candidate.path);
    repositories.set(candidate.id, { id: candidate.id, path: candidate.path });
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

export async function listRepositorySummaries() {
  const repositories = await discoverRepositories({ refresh: true });
  const summaries = await Promise.all(
    [...repositories.values()].map(async (repository) => {
      try {
        return await repositoryStatus(repository);
      } catch (error) {
        return {
          id: repository.id,
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

export async function repositoryFiles(repositoryId) {
  const repository = await getRepository(repositoryId);
  const output = await execGit(repository.path, [
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z",
  ]);
  const files = [...new Set(output.split("\0").filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  return { repositoryId, files };
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

export async function fetchAll() {
  const repositories = [...(await discoverRepositories({ refresh: true })).values()];
  const results = await mapWithConcurrency(repositories, 3, async (repository) => {
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
