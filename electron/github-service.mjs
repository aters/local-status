import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STATUS_TIMEOUT_MS = 10_000;
const REPOSITORY_TIMEOUT_MS = 20_000;
const SEARCH_TIMEOUT_MS = 45_000;
const MAX_OUTPUT = 16 * 1024 * 1024;
const REPOSITORY_CHUNK_SIZE = 20;
const SEARCH_FIELDS = [
  "author",
  "isDraft",
  "number",
  "repository",
  "state",
  "title",
  "updatedAt",
  "url",
].join(",");

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function executableCandidates(environment, homeDirectory) {
  const pathCandidates = (environment.PATH || "")
    .split(":")
    .filter((entry) => isAbsolute(entry))
    .map((entry) => join(entry, "gh"));
  return unique([
    environment.LOCAL_STATUS_GH_PATH,
    ...pathCandidates,
    join(homeDirectory, ".local", "bin", "gh"),
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
  ]);
}

function safeErrorText(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function commandError(error, fallback) {
  if (error?.killed || error?.signal === "SIGTERM") {
    return new Error("GitHub CLI did not finish before the request timed out.");
  }
  const detail = safeErrorText(error?.stderr || error?.stdout || error?.message);
  if (/not logged|not authenticated|authentication|auth login|http 401/i.test(detail)) {
    return new Error(
      "GitHub CLI is not signed in to github.com. Run gh auth login, then refresh.",
    );
  }
  return new Error(detail ? `${fallback} ${detail}` : fallback);
}

function parseJson(output, label) {
  try {
    return JSON.parse(String(output || "").trim());
  } catch {
    throw new Error(`GitHub CLI returned invalid ${label} data.`);
  }
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency(values, concurrency, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(values[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return results;
}

function canonicalRepository(value) {
  if (!value || typeof value !== "object") return null;
  const nameWithOwner =
    typeof value.nameWithOwner === "string" ? value.nameWithOwner.trim() : "";
  const parts = nameWithOwner.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part))
  ) {
    return null;
  }
  try {
    const url = new URL(value.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname.replace(/\/+$/, "").toLowerCase() !==
        `/${nameWithOwner}`.toLowerCase()
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return nameWithOwner;
}

export function validatePullRequestUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("Invalid pull request URL.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid pull request URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/[1-9]\d*\/?$/.test(
      url.pathname,
    )
  ) {
    throw new Error("Only github.com pull request links can be opened.");
  }
  return url.toString();
}

function parsePullRequests(output, repositoryNames) {
  const payload = parseJson(output, "pull request");
  if (!Array.isArray(payload)) {
    throw new Error("GitHub CLI returned invalid pull request data.");
  }
  const repositories = new Set(
    repositoryNames.map((repository) => repository.toLowerCase()),
  );
  return payload.map((entry) => {
    const repository =
      typeof entry?.repository?.nameWithOwner === "string"
        ? entry.repository.nameWithOwner
        : "";
    const number = Number(entry?.number);
    const title = typeof entry?.title === "string" ? entry.title.trim() : "";
    const author =
      typeof entry?.author?.login === "string"
        ? entry.author.login.trim()
        : "ghost";
    const updatedAt =
      typeof entry?.updatedAt === "string" ? entry.updatedAt : "";
    const date = new Date(updatedAt);
    const url = validatePullRequestUrl(entry?.url);
    if (
      !repositories.has(repository.toLowerCase()) ||
      !Number.isInteger(number) ||
      number < 1 ||
      !title ||
      !author ||
      Number.isNaN(date.getTime()) ||
      entry?.state !== "open"
    ) {
      throw new Error("GitHub CLI returned invalid pull request data.");
    }
    const expectedPath = `/${repository}/pull/${number}`.toLowerCase();
    if (new URL(url).pathname.replace(/\/+$/, "").toLowerCase() !== expectedPath) {
      throw new Error("GitHub CLI returned an unexpected pull request URL.");
    }
    return {
      repository,
      number,
      title,
      author,
      isDraft: entry?.isDraft === true,
      updatedAt: date.toISOString(),
      url,
    };
  });
}

function deduplicateAndSort(entries) {
  const uniqueEntries = new Map();
  for (const entry of entries) uniqueEntries.set(entry.url, entry);
  return [...uniqueEntries.values()].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() ||
      left.repository.localeCompare(right.repository) ||
      left.number - right.number,
  );
}

export class GithubService {
  constructor({
    environment = process.env,
    homeDirectory = homedir(),
    runFile = execFileAsync,
  } = {}) {
    this.environment = environment;
    this.homeDirectory = homeDirectory;
    this.runFile = runFile;
  }

  async validateExecutable(candidate) {
    if (typeof candidate !== "string" || !isAbsolute(candidate)) return null;
    try {
      const executablePath = await realpath(candidate);
      await access(executablePath, constants.X_OK);
      const result = await this.runFile(executablePath, ["--version"], {
        encoding: "utf8",
        timeout: STATUS_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: this.environment,
      });
      return /\bgh version\b/i.test(
        `${result.stdout || ""}\n${result.stderr || ""}`,
      )
        ? executablePath
        : null;
    } catch {
      return null;
    }
  }

  async resolveExecutable() {
    for (const candidate of executableCandidates(
      this.environment,
      this.homeDirectory,
    )) {
      const executable = await this.validateExecutable(candidate);
      if (executable) return executable;
    }
    throw new Error(
      "GitHub CLI was not found. Install gh, sign in with gh auth login, then refresh.",
    );
  }

  commandEnvironment() {
    return {
      ...this.environment,
      GH_HOST: "github.com",
      GH_PROMPT_DISABLED: "1",
      NO_COLOR: "1",
    };
  }

  async run(executable, args, { cwd, timeout = SEARCH_TIMEOUT_MS } = {}) {
    try {
      return await this.runFile(executable, args, {
        cwd,
        encoding: "utf8",
        timeout,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        env: this.commandEnvironment(),
      });
    } catch (error) {
      throw commandError(error, "GitHub CLI could not complete the request.");
    }
  }

  async activeAccount(executable) {
    const result = await this.run(
      executable,
      [
        "auth",
        "status",
        "--active",
        "--hostname",
        "github.com",
        "--json",
        "hosts",
      ],
      { timeout: STATUS_TIMEOUT_MS },
    );
    const payload = parseJson(result.stdout, "authentication");
    const accounts = payload?.hosts?.["github.com"];
    const active = Array.isArray(accounts)
      ? accounts.find(
          (account) =>
            account?.active === true &&
            account?.state === "success" &&
            typeof account?.login === "string" &&
            account.login.trim(),
        )
      : null;
    if (!active) {
      throw new Error(
        "GitHub CLI is not signed in to github.com. Run gh auth login, then refresh.",
      );
    }
    return active.login.trim();
  }

  async resolveRepository(executable, repository) {
    try {
      const result = await this.run(
        executable,
        ["repo", "view", "--json", "nameWithOwner,url"],
        { cwd: repository.path, timeout: REPOSITORY_TIMEOUT_MS },
      );
      return canonicalRepository(parseJson(result.stdout, "repository"));
    } catch {
      return null;
    }
  }

  async search(executable, repositoryNames, qualifier, value) {
    const collected = [];
    for (const repositoryChunk of chunks(
      repositoryNames,
      REPOSITORY_CHUNK_SIZE,
    )) {
      const repositoryArgs = repositoryChunk.flatMap((repository) => [
        "--repo",
        repository,
      ]);
      const result = await this.run(executable, [
        "search",
        "prs",
        "--state",
        "open",
        qualifier,
        value,
        ...repositoryArgs,
        "--limit",
        "1000",
        "--sort",
        "updated",
        "--order",
        "desc",
        "--json",
        SEARCH_FIELDS,
      ]);
      collected.push(...parsePullRequests(result.stdout, repositoryChunk));
    }
    return deduplicateAndSort(collected);
  }

  async list(repositories, { excludeGroupIds = [] } = {}) {
    const executable = await this.resolveExecutable();
    const account = await this.activeAccount(executable);
    const excluded = new Set(excludeGroupIds);
    const uniqueGroups = new Map();
    for (const repository of repositories) {
      if (
        !repository ||
        excluded.has(repository.groupId) ||
        uniqueGroups.has(repository.groupId)
      ) {
        continue;
      }
      uniqueGroups.set(repository.groupId, repository);
    }
    const candidates = [...uniqueGroups.values()];
    const resolved = await mapWithConcurrency(
      candidates,
      4,
      async (repository) => ({
        repository,
        canonical: await this.resolveRepository(executable, repository),
      }),
    );
    const skippedRepositories = resolved
      .filter((entry) => !entry.canonical)
      .map((entry) => entry.repository.id)
      .sort((left, right) => left.localeCompare(right));
    const repositoryNames = unique(
      resolved.map((entry) => entry.canonical),
    ).sort((left, right) => left.localeCompare(right));

    if (!repositoryNames.length) {
      return {
        generatedAt: new Date().toISOString(),
        account,
        repositoryCount: 0,
        skippedRepositories,
        createdByMe: [],
        reviewRequested: [],
      };
    }

    const [createdByMe, requested] = await Promise.all([
      this.search(executable, repositoryNames, "--author", "@me"),
      this.search(
        executable,
        repositoryNames,
        "--review-requested",
        "@me",
      ),
    ]);
    const authoredUrls = new Set(createdByMe.map((pullRequest) => pullRequest.url));
    return {
      generatedAt: new Date().toISOString(),
      account,
      repositoryCount: repositoryNames.length,
      skippedRepositories,
      createdByMe,
      reviewRequested: requested.filter(
        (pullRequest) => !authoredUrls.has(pullRequest.url),
      ),
    };
  }
}

export const __testing = {
  canonicalRepository,
  deduplicateAndSort,
  executableCandidates,
  parsePullRequests,
};
