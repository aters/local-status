import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalStatusBridge, WorkspaceFile } from "../types";
import { QuickOpen } from "./QuickOpen";
import { rankWorkspaceFiles } from "./quick-open-ranking";

const files: WorkspaceFile[] = [
  { repositoryId: "web", path: "src/components/AppShell.tsx" },
  { repositoryId: "api", path: "src/app.ts" },
  { repositoryId: "web", path: "README.md" },
];

beforeEach(() => {
  window.localStorage.clear();
  window.localStatus = {
    repositories: {
      workspaceFiles: vi.fn(async () => ({
        generatedAt: new Date().toISOString(),
        files,
        errors: [{ repositoryId: "unavailable", error: "Timed out" }],
        truncated: false,
      })),
    },
  } as unknown as LocalStatusBridge;
});

afterEach(cleanup);

describe("Quick Open", () => {
  it("ranks basename matches before path and fuzzy matches", () => {
    expect(rankWorkspaceFiles(files, "app", "web")).toEqual([
      { repositoryId: "api", path: "src/app.ts" },
      { repositoryId: "web", path: "src/components/AppShell.tsx" },
    ]);
  });

  it("opens a selected result with keyboard navigation and restores focus", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.append(trigger);
    trigger.focus();

    const { rerender } = render(
      <QuickOpen
        open
        workspacePath="/workspace"
        selectedRepositoryId="web"
        onClose={onClose}
        onOpen={onOpen}
      />,
    );

    const search = await screen.findByRole("searchbox", { name: "Search files" });
    await user.type(search, "app");
    await waitFor(() =>
      expect(screen.getAllByRole("option")).toHaveLength(2),
    );
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onOpen).toHaveBeenCalledWith({
      repositoryId: "web",
      path: "src/components/AppShell.tsx",
    });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <QuickOpen
        open={false}
        workspacePath="/workspace"
        selectedRepositoryId="web"
        onClose={onClose}
        onOpen={onOpen}
      />,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("reports partial repository failures without blocking results", async () => {
    render(
      <QuickOpen
        open
        workspacePath="/workspace"
        selectedRepositoryId={null}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    const search = await screen.findByRole("searchbox", { name: "Search files" });
    await userEvent.type(search, "readme");

    expect(await screen.findByRole("option", { name: /README\.md.*web/i })).toBeVisible();
    expect(screen.getByText("1 repository was unavailable.")).toBeVisible();
  });
});
