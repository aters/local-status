import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPOSITORY_MARK_CAPACITY,
  repositoryMarkVisual,
  repositoryMarkVisuals,
} from "../repository-mark";
import type { RepositorySummary } from "../types";
import { RepositoryMark } from "./RepositoryMark";

const repository: RepositorySummary = {
  id: "changed-web",
  groupId: "group-changed-web",
  groupName: "changed-web",
  remoteIdentity: "https://example.test/changed-web",
  isPrimaryWorktree: true,
  isWorkspaceRoot: false,
  favourite: false,
  archived: false,
  branch: "main",
  detached: false,
  unborn: false,
  headSha: "a".repeat(40),
  upstream: "origin/main",
  incoming: 0,
  outgoing: 0,
  summary: {
    files: 2,
    staged: 0,
    modified: 1,
    untracked: 1,
    conflicts: 0,
  },
  latestCommit: null,
  fetchedAt: null,
  scannedAt: new Date(0).toISOString(),
  error: null,
};

afterEach(() => cleanup());

describe("RepositoryMark", () => {
  it("selects stable visuals from the vetted symbol set", () => {
    expect(repositoryMarkVisual("changed-web")).toEqual(
      repositoryMarkVisual("changed-web"),
    );
    expect(repositoryMarkVisual("changed-web")).not.toEqual(
      repositoryMarkVisual("clean-api"),
    );
  });

  it("allocates unique deterministic visuals across a workspace", () => {
    const repositoryIds = Array.from(
      { length: REPOSITORY_MARK_CAPACITY },
      (_, index) => `repository-${index}`,
    );
    const forward = repositoryMarkVisuals(repositoryIds);
    const reversed = repositoryMarkVisuals([...repositoryIds].reverse());
    const visualKey = (repositoryId: string) =>
      JSON.stringify(forward.get(repositoryId));

    expect(new Set(repositoryIds.map(visualKey)).size).toBe(
      REPOSITORY_MARK_CAPACITY,
    );
    for (const repositoryId of repositoryIds) {
      expect(forward.get(repositoryId)).toEqual(reversed.get(repositoryId));
    }
  });

  it("de-duplicates repositories that prefer the same hashed visual", () => {
    expect(repositoryMarkVisual("repo-9")).toEqual(
      repositoryMarkVisual("repo-30"),
    );

    const visuals = repositoryMarkVisuals(["repo-9", "repo-30"]);

    expect(visuals.get("repo-9")).not.toEqual(visuals.get("repo-30"));
  });

  it("falls back to deterministic reuse only after the visual pool is exhausted", () => {
    const repositoryIds = Array.from(
      { length: REPOSITORY_MARK_CAPACITY + 7 },
      (_, index) => `large-workspace-${index}`,
    );
    const visuals = repositoryMarkVisuals(repositoryIds);
    const unique = new Set(
      [...visuals.values()].map((visual) => JSON.stringify(visual)),
    );

    expect(visuals.size).toBe(REPOSITORY_MARK_CAPACITY + 7);
    expect(unique.size).toBe(REPOSITORY_MARK_CAPACITY);
  });

  it("uses the generated mark with a separate working-tree status border", () => {
    render(<RepositoryMark repository={repository} />);

    const mark = screen.getByRole("img", { name: "Uncommitted changes" });
    expect(mark).toHaveTextContent("");
    expect(mark).toHaveClass("repository-mark--changed");
    expect(mark.querySelector("svg")).toHaveAttribute(
      "data-symbol",
      String(repositoryMarkVisual(repository.id).symbol),
    );
    expect(mark).toHaveStyle({
      "--repo-mark-background": repositoryMarkVisual(repository.id).background,
    });
  });

  it("renders a workspace-allocated visual consistently", () => {
    const visual = {
      background: "#302421" as const,
      foreground: "#e2ad94" as const,
      symbol: 15,
    };
    render(<RepositoryMark repository={repository} visual={visual} />);

    const mark = screen.getByRole("img", { name: "Uncommitted changes" });
    expect(mark.querySelector("svg")).toHaveAttribute("data-symbol", "15");
    expect(mark).toHaveStyle({
      "--repo-mark-background": visual.background,
      "--repo-mark-foreground": visual.foreground,
    });
  });
});
