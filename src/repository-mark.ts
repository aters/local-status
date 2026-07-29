import type { RepositorySummary } from "./types";

export type RepositoryHealth = "clean" | "changed" | "conflict" | "error";

const palettes = [
  { background: "#17282d", foreground: "#83d8e6" },
  { background: "#182633", foreground: "#8fc4e8" },
  { background: "#20233a", foreground: "#a9b2f1" },
  { background: "#282039", foreground: "#c4a8e8" },
  { background: "#1d2933", foreground: "#9ec5dc" },
  { background: "#1a292c", foreground: "#8dccd1" },
  { background: "#242431", foreground: "#b9b8dc" },
  { background: "#24212f", foreground: "#c0abd8" },
] as const;

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (const character of value.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function repositoryHealth(repository: RepositorySummary): RepositoryHealth {
  if (repository.error) return "error";
  if (repository.summary.conflicts) return "conflict";
  if (repository.summary.files) return "changed";
  return "clean";
}

export function repositoryMarkVisual(repositoryId: string) {
  const hash = stableHash(repositoryId);
  return {
    ...palettes[hash % palettes.length],
    symbol: (hash >>> 8) % 8,
  };
}
