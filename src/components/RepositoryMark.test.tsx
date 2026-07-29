import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { repositoryMarkVisual } from "../repository-mark";
import type { RepositorySummary } from "../types";
import { RepositoryMark } from "./RepositoryMark";

const repository: RepositorySummary = {
  id: "changed-web",
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
});
