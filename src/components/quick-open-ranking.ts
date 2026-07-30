import type { WorkspaceFile } from "../types";

const MAX_RESULTS = 50;

export function quickOpenFileName(path: string) {
  return path.split("/").at(-1) || path;
}

export function quickOpenParentPath(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function fuzzyScore(value: string, query: string) {
  let valueIndex = 0;
  let queryIndex = 0;
  let gaps = 0;
  while (valueIndex < value.length && queryIndex < query.length) {
    if (value[valueIndex] === query[queryIndex]) queryIndex += 1;
    else if (queryIndex > 0) gaps += 1;
    valueIndex += 1;
  }
  return queryIndex === query.length ? gaps + valueIndex - query.length : null;
}

function matchScore(file: WorkspaceFile, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const name = quickOpenFileName(file.path).toLowerCase();
  const path = file.path.toLowerCase();
  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) {
    return 10 + name.length - normalizedQuery.length;
  }
  const nameIndex = name.indexOf(normalizedQuery);
  if (nameIndex >= 0) return 30 + nameIndex;
  const pathIndex = path.indexOf(normalizedQuery);
  if (pathIndex >= 0) return 60 + pathIndex;
  const fuzzy = fuzzyScore(path, normalizedQuery);
  return fuzzy === null ? null : 100 + fuzzy;
}

export function rankWorkspaceFiles(
  files: WorkspaceFile[],
  query: string,
  selectedRepositoryId: string | null,
) {
  return files
    .map((file) => ({ file, score: matchScore(file, query) }))
    .filter(
      (entry): entry is { file: WorkspaceFile; score: number } =>
        entry.score !== null,
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        Number(right.file.repositoryId === selectedRepositoryId) -
          Number(left.file.repositoryId === selectedRepositoryId) ||
        left.file.path.length - right.file.path.length ||
        left.file.repositoryId.localeCompare(right.file.repositoryId) ||
        left.file.path.localeCompare(right.file.path),
    )
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.file);
}
