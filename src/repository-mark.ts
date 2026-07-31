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
  { background: "#183028", foreground: "#88d8ad" },
  { background: "#302421", foreground: "#e2ad94" },
  { background: "#2e2920", foreground: "#dfc27c" },
  { background: "#202d25", foreground: "#a9d18d" },
  { background: "#2f2029", foreground: "#e2a3c2" },
  { background: "#1e2b37", foreground: "#84c4de" },
  { background: "#29263a", foreground: "#b6a7ec" },
  { background: "#263035", foreground: "#9bc8d0" },
] as const;
const symbolCount = 16;

export interface RepositoryMarkVisual {
  background: (typeof palettes)[number]["background"];
  foreground: (typeof palettes)[number]["foreground"];
  symbol: number;
}

export const REPOSITORY_MARK_CAPACITY = palettes.length * symbolCount;

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (const character of value.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function visualForSlot(slot: number): RepositoryMarkVisual {
  return {
    ...palettes[slot % palettes.length],
    symbol: Math.floor(slot / palettes.length) % symbolCount,
  };
}

function preferredSlot(repositoryId: string) {
  return stableHash(repositoryId) % REPOSITORY_MARK_CAPACITY;
}

export function repositoryHealth(repository: RepositorySummary): RepositoryHealth {
  if (repository.error) return "error";
  if (repository.summary.conflicts) return "conflict";
  if (repository.summary.files) return "changed";
  return "clean";
}

export function repositoryMarkVisual(repositoryId: string): RepositoryMarkVisual {
  return visualForSlot(preferredSlot(repositoryId));
}

export function repositoryMarkVisuals(
  repositoryIds: Iterable<string>,
): ReadonlyMap<string, RepositoryMarkVisual> {
  const ids = [...new Set(repositoryIds)].sort(
    (left, right) =>
      stableHash(left) - stableHash(right) ||
      (left < right ? -1 : left > right ? 1 : 0),
  );
  const used = new Set<number>();
  const visuals = new Map<string, RepositoryMarkVisual>();

  for (const repositoryId of ids) {
    const hash = stableHash(repositoryId);
    const preferred = preferredSlot(repositoryId);
    let slot = preferred;
    if (used.size < REPOSITORY_MARK_CAPACITY) {
      const stride =
        (((hash >>> 16) % (REPOSITORY_MARK_CAPACITY / 2)) * 2 + 1) %
          REPOSITORY_MARK_CAPACITY || 1;
      while (used.has(slot)) {
        slot = (slot + stride) % REPOSITORY_MARK_CAPACITY;
      }
      used.add(slot);
    }
    visuals.set(repositoryId, visualForSlot(slot));
  }

  return visuals;
}

export const __testing = {
  palettes,
  stableHash,
  symbolCount,
  visualForSlot,
};
