import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  ChangeItem,
  LocalStatusBridge,
  RepositoriesResponse,
} from "./types";

vi.mock("./components/MonacoDiff", () => ({
  default: ({ findRequest }: { findRequest?: number }) => (
    <div data-find-request={findRequest} data-testid="diff-viewer">
      Side-by-side diff
    </div>
  ),
}));

vi.mock("./components/TerminalPane", () => ({
  TerminalPane: ({
    autoFocus,
    findRequest,
  }: {
    autoFocus?: boolean;
    findRequest?: number;
  }) => (
    <div
      data-autofocus={String(Boolean(autoFocus))}
      data-find-request={findRequest}
      data-testid="terminal-pane"
    >
      Terminal
    </div>
  ),
}));

const repositories: RepositoriesResponse = {
  generatedAt: new Date().toISOString(),
  rootKind: "workspace" as "repository" | "workspace" | "hybrid",
  workspaceName: "engineering",
  repositories: [
    {
      id: "clean-api",
      groupId: "clean-api",
      groupName: "clean-api",
      remoteIdentity: null,
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
      summary: { files: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 },
      latestCommit: {
        sha: "a".repeat(40),
        shortSha: "aaaaaaa",
        author: "Developer",
        authoredAt: new Date().toISOString(),
        subject: "Clean commit",
      },
      fetchedAt: null,
      scannedAt: new Date().toISOString(),
      error: null,
    },
    {
      id: "changed-web",
      groupId: "changed-web",
      groupName: "changed-web",
      remoteIdentity: null,
      isPrimaryWorktree: true,
      isWorkspaceRoot: false,
      favourite: false,
      archived: false,
      branch: "feature",
      detached: false,
      unborn: false,
      headSha: "b".repeat(40),
      upstream: "origin/feature",
      incoming: 2,
      outgoing: 1,
      summary: { files: 2, staged: 0, modified: 1, untracked: 1, conflicts: 0 },
      latestCommit: {
        sha: "b".repeat(40),
        shortSha: "bbbbbbb",
        author: "Developer",
        authoredAt: new Date().toISOString(),
        subject: "Changed commit",
      },
      fetchedAt: null,
      scannedAt: new Date().toISOString(),
      error: null,
    },
  ],
};

const aiProviders = {
  codex: {
    id: "codex" as const,
    label: "Codex",
    available: true,
    authenticated: true,
    executablePath: "/usr/local/bin/codex",
    version: "codex-cli 9.9.9",
    models: [
      { id: "gpt-5.6-luna", label: "Luna", description: "Fast" },
      { id: "gpt-5.6-sol", label: "Sol", description: "Deep" },
    ],
    error: null,
  },
  claude: {
    id: "claude" as const,
    label: "Claude",
    available: false,
    authenticated: false,
    executablePath: null,
    version: null,
    models: [
      { id: "haiku", label: "Haiku", description: "Fast" },
      { id: "sonnet", label: "Sonnet", description: "Balanced" },
    ],
    error: "Claude CLI was not found.",
  },
};

function createBridge(current = true) {
  const terminalCallbacks = new Set<(event: never) => void>();
  const shortcutCallbacks = new Set<(shortcut: "quick-open" | "find") => void>();
  return {
    workspace: {
      getCurrent: vi.fn(async () => ({
        current: current ? { path: "/tmp/engineering", name: "engineering" } : null,
        recent: [],
      })),
      choose: vi.fn(async () => ({
        current: { path: "/tmp/engineering", name: "engineering" },
        recent: [{ path: "/tmp/engineering", name: "engineering" }],
      })),
      openRecent: vi.fn(),
    },
    repositories: {
      list: vi.fn(async () => repositories),
      changes: vi.fn(async () => ({
        repositoryId: "changed-web",
        changes: [
          {
            id: "working:src/App.tsx",
            path: "src/App.tsx",
            previousPath: null,
            scope: "working",
            kind: "modified",
            status: "M",
          },
          {
            id: "untracked:src/NewPanel.tsx",
            path: "src/NewPanel.tsx",
            previousPath: null,
            scope: "untracked",
            kind: "untracked",
            status: "?",
          },
        ],
      })),
      commits: vi.fn(async () => ({
        repositoryId: "changed-web",
        scope: "local",
        commits: [],
      })),
      commit: vi.fn(),
      files: vi.fn(async () => ({ repositoryId: "changed-web", files: [] })),
      workspaceFiles: vi.fn(async () => ({
        generatedAt: new Date().toISOString(),
        files: [
          { repositoryId: "changed-web", path: "src/App.tsx" },
          { repositoryId: "changed-web", path: "README.md" },
          { repositoryId: "clean-api", path: "package.json" },
        ],
        errors: [],
        truncated: false,
      })),
      comparison: vi.fn(async (repositoryId, options) => ({
        repositoryId,
        path: options.path,
        previousPath: null,
        language: "typescript",
        original: {
          content: "",
          source: "index",
          label: "Index",
          binary: false,
          truncated: false,
          missing: false,
        },
        modified: {
          content: "export const ready = true;",
          source: "working",
          label: "Working tree",
          binary: false,
          truncated: false,
          missing: false,
        },
      })),
      fetch: vi.fn(),
      fetchAll: vi.fn(),
      prepareCommit: vi.fn(async (repositoryId) => ({
        repositoryId,
        snapshotId: "c".repeat(64),
        branch: "feature",
        detached: false,
        unborn: false,
        stagedFiles: [
          {
            path: "src/App.tsx",
            previousPath: null,
            kind: "modified",
            status: "M",
          },
        ],
      })),
      createCommit: vi.fn(async (repositoryId) => ({
        repositoryId,
        commit: {
          sha: "d".repeat(40),
          shortSha: "ddddddd",
          author: "Developer",
          authoredAt: new Date().toISOString(),
          subject: "feat: generated commit",
        },
        changes: [],
      })),
      stage: vi.fn(async (repositoryId, selection) => ({
        repositoryId,
        changes: [
          {
            id: `staged:${selection.path}`,
            path: selection.path ?? "src/App.tsx",
            previousPath: null,
            scope: "staged",
            kind: "modified",
            status: "M",
          },
        ],
      })),
      unstage: vi.fn(async (repositoryId) => ({
        repositoryId,
        changes: [],
      })),
      revert: vi.fn(async (repositoryId) => ({
        repositoryId,
        changes: [
          {
            id: "working:src/App.tsx",
            path: "src/App.tsx",
            previousPath: null,
            scope: "working",
            kind: "modified",
            status: "M",
          },
        ],
      })),
      stashes: vi.fn(async (repositoryId) => ({
        repositoryId,
        stashes: [
          {
            id: "e".repeat(40),
            ref: "stash@{0}",
            subject: "On feature: checkpoint",
            message: "checkpoint",
            branch: "feature",
            createdAt: new Date().toISOString(),
            fileCount: 2,
          },
        ],
      })),
      stash: vi.fn(async (repositoryId, stashId) => ({
        repositoryId,
        stash: {
          id: stashId,
          ref: "stash@{0}",
          subject: "On feature: checkpoint",
          message: "checkpoint",
          branch: "feature",
          createdAt: new Date().toISOString(),
          fileCount: 2,
        },
        files: [
          { status: "M", path: "src/App.tsx", previousPath: null },
          { status: "A", path: "src/NewPanel.tsx", previousPath: null },
        ],
      })),
      createStash: vi.fn(async (repositoryId) => ({
        repositoryId,
        stash: {
          id: "f".repeat(40),
          ref: "stash@{0}",
          subject: "On feature: checkpoint",
          message: "checkpoint",
          branch: "feature",
          createdAt: new Date().toISOString(),
          fileCount: 2,
        },
        changes: [],
        remainingFiles: 0,
      })),
      applyStash: vi.fn(async (repositoryId) => ({
        repositoryId,
        outcome: "applied" as const,
        stashRetained: true,
        changes: [],
      })),
      popStash: vi.fn(async (repositoryId) => ({
        repositoryId,
        outcome: "applied" as const,
        stashRetained: false,
        changes: [],
      })),
      dropStash: vi.fn(async (repositoryId, stashId) => ({
        repositoryId,
        stashId,
        dropped: true,
      })),
      sync: vi.fn(async (repositoryId) => ({
        outcome: "synced" as const,
        repositoryId,
        upstream: "origin/feature",
        pulled: 2,
        pushed: 1,
        incoming: 0,
        outgoing: 0,
        syncedAt: new Date().toISOString(),
      })),
      scripts: vi.fn(async () => ({
        repositoryId: "changed-web",
        scripts: [
          {
            name: "dev",
            runner: "npm",
            command: "npm",
            args: ["run", "dev"],
          },
        ],
      })),
      setArchived: vi.fn(async (repositoryId, archived) => ({
        ...repositories,
        repositories: repositories.repositories.map((repository) => ({
          ...repository,
          archived: repository.id === repositoryId ? archived : false,
        })),
      })),
      rename: vi.fn(async (repositoryId, name) => ({
        ...repositories,
        repositories: repositories.repositories.map((repository) => ({
          ...repository,
          displayName: repository.id === repositoryId ? name : repository.id,
        })),
      })),
      branches: vi.fn(async (repositoryId) => ({
        repositoryId,
        local: [
          { name: "main", ref: "refs/heads/main", remote: false, current: false },
          { name: "master", ref: "refs/heads/master", remote: false, current: false },
          { name: "staging", ref: "refs/heads/staging", remote: false, current: false },
          { name: "feature/current", ref: "refs/heads/feature/current", remote: false, current: true },
          { name: "alpha", ref: "refs/heads/alpha", remote: false, current: false },
        ],
        remote: [
          { name: "origin/release", ref: "refs/remotes/origin/release", remote: true, current: false },
        ],
      })),
      switchBranch: vi.fn(async (repositoryId) => ({
        repositoryId,
        requiresStash: false,
        cancelled: false,
      })),
    },
    shortcuts: {
      onRequest: vi.fn((callback) => shortcutCallbacks.add(callback)),
      offRequest: vi.fn((callback) => shortcutCallbacks.delete(callback)),
    },
    ai: {
      status: vi.fn(async () => ({
        provider: "codex" as const,
        model: "gpt-5.6-luna",
        selectedModels: {
          codex: "gpt-5.6-luna",
          claude: "haiku",
        },
        disclosureAccepted: false,
        conflictDisclosureAccepted: false,
        providers: aiProviders,
      })),
      setPreferences: vi.fn(async (provider, model) => ({
        provider,
        model,
        selectedModels: {
          codex: provider === "codex" ? model : "gpt-5.6-luna",
          claude: provider === "claude" ? model : "haiku",
        },
        disclosureAccepted: false,
        conflictDisclosureAccepted: false,
        providers: aiProviders,
      })),
      chooseExecutable: vi.fn(),
      acceptDisclosure: vi.fn(async () => true),
      generateCommitMessage: vi.fn(async (input) => ({
        message: "feat: generated commit",
        snapshotId: input.snapshotId,
        patchTruncated: false,
        provider: "codex" as const,
        model: "gpt-5.6-luna",
      })),
      startConflictResolution: vi.fn(),
      cancelGeneration: vi.fn(async () => true),
    },
    profiles: {
      list: vi.fn(async () => []),
      save: vi.fn(),
      remove: vi.fn(),
    },
    terminals: {
      list: vi.fn(async () => []),
      create: vi.fn(async (input) => ({
        id: "terminal-1",
        repositoryId: input.repositoryId,
        title: `${input.repositoryId} terminal`,
        kind: input.kind,
        status: "running",
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null,
        signal: null,
        truncated: false,
        buffer: "",
      })),
      write: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      rename: vi.fn(async (sessionId, title) => ({
        id: sessionId,
        repositoryId: "changed-web",
        title,
        kind: "shell" as const,
        status: "running" as const,
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null,
        signal: null,
        truncated: false,
        buffer: "",
      })),
      close: vi.fn(),
      onEvent: vi.fn((callback) => terminalCallbacks.add(callback)),
      offEvent: vi.fn((callback) => terminalCallbacks.delete(callback)),
    },
    system: {
      listeners: vi.fn(async () => ({ generatedAt: new Date().toISOString(), listeners: [] })),
      openLocalUrl: vi.fn(),
    },
  } as unknown as LocalStatusBridge;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/#view=repositories");
  window.localStorage.clear();
  window.localStatus = createBridge();
});

afterEach(() => cleanup());

describe("Local Status", () => {
  it("shows onboarding and opens a selected workspace", async () => {
    const user = userEvent.setup();
    window.localStatus = createBridge(false);
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Choose repository or workspace",
      }),
    );

    expect((await screen.findAllByText("changed-web")).length).toBeGreaterThan(0);
    expect(window.localStatus.workspace.choose).toHaveBeenCalledOnce();
  });

  it("labels a directly opened Git root as a repository", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.repositories.list).mockResolvedValueOnce({
      ...repositories,
      rootKind: "repository",
      workspaceName: "clean-api",
      repositories: [
        {
          ...repositories.repositories[0],
          isWorkspaceRoot: true,
        },
      ],
    });
    window.localStatus = bridge;

    render(<App />);

    expect(await screen.findByText("Local Git repository")).toBeVisible();
    expect(screen.getByRole("button", { name: "Repository" })).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Find a repository" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Filter repositories"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Repositories" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".repository-workspace")).toHaveClass(
      "is-single-repository",
    );
  });

  it("shows a Git root with child repositories as a marked hybrid workspace", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.repositories.list).mockResolvedValueOnce({
      ...repositories,
      rootKind: "hybrid",
      workspaceName: "argus-full",
      repositories: [
        {
          ...repositories.repositories[0],
          id: "argus-full",
          displayName: "argus-full",
          isWorkspaceRoot: true,
        },
        {
          ...repositories.repositories[1],
          id: "argus",
          displayName: "argus",
          isWorkspaceRoot: false,
        },
      ],
    });
    window.localStatus = bridge;

    render(<App />);

    expect(await screen.findByText("Git repository workspace")).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Find a repository" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Filter repositories")).toBeVisible();
    expect(screen.getByTitle("Selected folder")).toHaveTextContent("Root");
    expect(document.querySelector(".repository-workspace")).not.toHaveClass(
      "is-single-repository",
    );
  });

  it("preserves fetched repositories when workspace selection is cancelled", async () => {
    const user = userEvent.setup();
    vi.mocked(window.localStatus.workspace.choose).mockResolvedValueOnce(null);
    render(<App />);

    expect(await screen.findByText("changed-web")).toBeInTheDocument();
    expect(window.localStatus.repositories.list).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "engineering" }));
    await user.click(
      screen.getByRole("menuitem", {
        name: "Open repository or workspace…",
      }),
    );

    await waitFor(() =>
      expect(window.localStatus.workspace.choose).toHaveBeenCalledOnce(),
    );
    expect(window.localStatus.repositories.list).toHaveBeenCalledOnce();
    expect(
      within(screen.getByRole("list", { name: "Repositories" })).getByText(
        "changed-web",
      ),
    ).toBeInTheDocument();
  });

  it("switches recent workspaces and opens the native picker from the header menu", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    bridge.workspace.getCurrent = vi.fn(async () => ({
      current: { path: "/tmp/engineering", name: "engineering" },
      recent: [
        { path: "/tmp/engineering", name: "engineering" },
        { path: "/tmp/client-apps", name: "client-apps" },
      ],
    }));
    bridge.workspace.openRecent = vi.fn(async () => ({
      current: { path: "/tmp/client-apps", name: "client-apps" },
      recent: [
        { path: "/tmp/client-apps", name: "client-apps" },
        { path: "/tmp/engineering", name: "engineering" },
      ],
    }));
    window.localStatus = bridge;
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "engineering" }));
    await user.click(screen.getByRole("menuitem", { name: /client-apps/i }));

    expect(bridge.workspace.openRecent).toHaveBeenCalledWith("/tmp/client-apps");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "client-apps" })).toBeVisible(),
    );

    await user.click(screen.getByRole("button", { name: "client-apps" }));
    await user.click(
      screen.getByRole("menuitem", {
        name: "Open repository or workspace…",
      }),
    );

    expect(bridge.workspace.choose).toHaveBeenCalledOnce();
  });

  it("keeps the workspace menu open when a recent workspace is unavailable", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    bridge.workspace.getCurrent = vi.fn(async () => ({
      current: { path: "/tmp/engineering", name: "engineering" },
      recent: [
        { path: "/tmp/engineering", name: "engineering" },
        { path: "/tmp/missing", name: "missing" },
      ],
    }));
    bridge.workspace.openRecent = vi.fn(async () => {
      throw new Error("That workspace is no longer available.");
    });
    window.localStatus = bridge;
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "engineering" }));
    await user.click(screen.getByRole("menuitem", { name: /missing/i }));

    expect(
      screen.getByRole("menu", {
        name: "Switch repository or workspace",
      }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That workspace is no longer available.",
    );
    expect(screen.getByRole("button", { name: "engineering" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renames and archives worktrees from their contextual menu", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    const groupedRepositories = {
      ...repositories,
      repositories: repositories.repositories.map((repository, index) => ({
        ...repository,
        id: index === 0 ? "commerce" : "commerce-feature",
        groupId: "group-commerce",
        groupName: "commerce",
        remoteIdentity: null,
        isPrimaryWorktree: index === 0,
        favourite: false,
        archived: false,
      })),
    };
    bridge.repositories.list = vi.fn(async () => groupedRepositories);
    bridge.repositories.rename = vi.fn(async (repositoryId, name) => ({
      ...groupedRepositories,
      repositories: groupedRepositories.repositories.map((repository) => ({
        ...repository,
        displayName:
          repository.id === repositoryId ? name : repository.id,
      })),
    }));
    bridge.repositories.setArchived = vi.fn(
      async (repositoryId, archived) => ({
        ...groupedRepositories,
        repositories: groupedRepositories.repositories.map((repository) => ({
          ...repository,
          archived: repository.id === repositoryId ? archived : false,
        })),
      }),
    );
    window.localStatus = bridge;
    render(<App />);

    expect(await screen.findByText("2 checkouts")).toBeVisible();
    const actionsButton = await screen.findByRole("button", {
      name: "More actions for commerce-feature",
    });
    await user.click(actionsButton);
    expect(actionsButton).toBeVisible();
    expect(actionsButton.closest(".repository-row")).toHaveClass(
      "is-context-menu-open",
    );
    const menu = screen.getByRole("menu", {
      name: "Actions for commerce-feature",
    });
    expect(within(menu).getByRole("menuitem", { name: "Archive" })).toBeVisible();
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", {
      name: "New name for commerce-feature",
    });
    await user.clear(input);
    await user.type(input, "Checkout Platform");
    await user.click(
      screen.getByRole("button", { name: "Save worktree name" }),
    );

    expect(bridge.repositories.rename).toHaveBeenCalledWith(
      "commerce-feature",
      "Checkout Platform",
    );
    expect(await screen.findAllByText("Checkout Platform")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", {
        name: "More actions for Checkout Platform",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(bridge.repositories.setArchived).toHaveBeenCalledWith(
      "commerce-feature",
      true,
    );
  });

  it("shows repository health, filters changes, and opens Quick Open", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("changed-web")).toBeInTheDocument();
    expect(screen.getByText("clean-api")).toBeInTheDocument();
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
    expect(screen.queryByText("Not fetched this session")).not.toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".status-badge--incoming" })).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: "Uncommitted changes changed-web" })
        .closest(".repository-row"),
    ).toHaveClass("repository-row--changed");
    expect(
      screen
        .getByRole("button", { name: "Clean working tree clean-api" })
        .closest(".repository-row"),
    ).toHaveClass("repository-row--clean");

    const repositoryPanel = screen.getByRole("list", { name: "Repositories" });
    await user.click(screen.getByRole("button", { name: "changed" }));
    expect(within(repositoryPanel).queryByText("clean-api")).not.toBeInTheDocument();
    expect(within(repositoryPanel).getByText("changed-web")).toBeVisible();

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const palette = await screen.findByRole("dialog", { name: "Quick Open" });
    expect(
      within(palette).getByRole("searchbox", { name: "Search files" }),
    ).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Find a repository" })).not.toHaveFocus();
  });

  it("shows main, master, and staging first in branch selection", async () => {
    const user = userEvent.setup();
    render(<App />);

    const branchButtons = await screen.findAllByRole("button", {
      name: "Switch branch for changed-web",
    });
    await user.click(branchButtons[0]);

    const picker = await screen.findByRole("dialog", {
      name: "Switch branch for changed-web",
    });
    const localSection = within(picker)
      .getByText("Local branches")
      .closest("section");
    const remoteSection = within(picker)
      .getByText("Remote-only branches")
      .closest("section");

    expect(localSection).not.toBeNull();
    expect(remoteSection).not.toBeNull();
    expect(
      within(localSection!).getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["main", "master", "staging", "feature/current", "alpha"]);
    expect(
      within(remoteSection!).getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["origin/release"]);
  });

  it("opens a workspace file from Quick Open and focuses contextual filters", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("changed-web");
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(
      await screen.findByRole("textbox", { name: "Filter changed files" }),
    ).toHaveFocus();

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const search = await screen.findByRole("searchbox", { name: "Search files" });
    await user.type(search, "App");
    await user.click(
      await screen.findByRole("option", { name: /App\.tsx.*changed-web/i }),
    );

    await waitFor(() => {
      expect(window.location.hash).toContain("repo=changed-web");
      expect(window.location.hash).toContain("tab=files");
      expect(window.location.hash).toContain("file=src%2FApp.tsx");
    });
    expect(window.localStatus.repositories.comparison).toHaveBeenCalledWith(
      "changed-web",
      { path: "src/App.tsx", scope: "working" },
    );
  });

  it("persists panel widths and starts a repository terminal", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("local-status:repo-width", "310");
    window.localStorage.setItem("local-status:context-width", "420");
    render(<App />);

    await waitFor(() =>
      expect(screen.getAllByText("changed-web").length).toBeGreaterThan(0),
    );
    expect(document.querySelector(".repository-workspace")).toHaveStyle({
      "--repo-panel-width": "310px",
      "--context-panel-width": "420px",
    });

    await user.click(
      screen.getByRole("button", {
        name: "Uncommitted changes changed-web",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "New terminal in this repository" }),
    );
    expect(window.localStatus.terminals.create).toHaveBeenCalledWith({
      repositoryId: "changed-web",
      kind: "shell",
      scriptName: undefined,
      profileId: undefined,
    });
    expect(await screen.findByRole("heading", { name: "Services & terminals" })).toBeVisible();
  });

  it("opens and dismisses the package-script menu", async () => {
    const user = userEvent.setup();
    render(<App />);

    const runButton = await screen.findByRole("button", {
      name: "Run a package script",
    });
    await user.click(runButton);

    expect(await screen.findByRole("menu", { name: "Package scripts" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /dev npm/ })).toBeVisible();
    expect(runButton).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("tab", { name: /Changes/ }));
    expect(screen.queryByRole("menu", { name: "Package scripts" })).not.toBeInTheDocument();
    expect(runButton).toHaveAttribute("aria-expanded", "false");

    await user.click(runButton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Package scripts" })).not.toBeInTheDocument();
    expect(runButton).toHaveFocus();
  });

  it("stages and reverts files and synchronizes the configured upstream", async () => {
    const user = userEvent.setup();
    render(<App />);

    const revertButton = await screen.findByRole("button", {
      name: "Revert src/App.tsx",
    });
    await user.click(revertButton);
    expect(window.localStatus.repositories.revert).toHaveBeenCalledWith(
      "changed-web",
      { scope: "working", path: "src/App.tsx" },
    );

    const stageButton = await screen.findByRole("button", {
      name: "Stage src/App.tsx",
    });
    await user.click(stageButton);
    expect(window.localStatus.repositories.stage).toHaveBeenCalledWith(
      "changed-web",
      { scope: "working", path: "src/App.tsx" },
    );

    const unstageButton = await screen.findByRole("button", {
      name: "Unstage src/App.tsx",
    });
    await user.click(unstageButton);
    expect(window.localStatus.repositories.unstage).toHaveBeenCalledWith(
      "changed-web",
      { scope: "staged", path: "src/App.tsx" },
    );

    await user.click(
      screen.getByRole("button", {
        name: "Sync changes: 2 incoming, 1 outgoing",
      }),
    );
    expect(window.localStatus.repositories.sync).toHaveBeenCalledWith("changed-web");
  });

  it("uses Shift-clicked file ranges for existing row actions", async () => {
    const batchChanges: ChangeItem[] = [
      {
        id: "working:src/App.tsx",
        path: "src/App.tsx",
        previousPath: null,
        scope: "working",
        kind: "modified",
        status: "M",
      },
      {
        id: "working:src/Details.tsx",
        path: "src/Details.tsx",
        previousPath: null,
        scope: "working",
        kind: "modified",
        status: "M",
      },
      {
        id: "untracked:src/NewPanel.tsx",
        path: "src/NewPanel.tsx",
        previousPath: null,
        scope: "untracked",
        kind: "untracked",
        status: "?",
      },
    ];
    vi.mocked(window.localStatus.repositories.changes).mockResolvedValue({
      repositoryId: "changed-web",
      changes: batchChanges,
    });
    vi.mocked(window.localStatus.repositories.stage).mockResolvedValue({
      repositoryId: "changed-web",
      changes: batchChanges,
    });
    vi.mocked(window.localStatus.repositories.revert).mockResolvedValue({
      repositoryId: "changed-web",
      changes: batchChanges,
    });
    render(<App />);

    const first = await screen.findByTitle("src/App.tsx");
    const last = await screen.findByTitle("src/NewPanel.tsx");
    fireEvent.click(first);
    fireEvent.click(last, { shiftKey: true });

    expect(document.querySelectorAll(".change-row.is-selected")).toHaveLength(3);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Stage 3 selected files",
      })[1],
    );
    await waitFor(() =>
      expect(window.localStatus.repositories.stage).toHaveBeenCalledWith(
        "changed-web",
        {
          scope: "unstaged",
          paths: [
            "src/App.tsx",
            "src/Details.tsx",
            "src/NewPanel.tsx",
          ],
        },
      ),
    );

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Revert 3 selected files",
      })[0],
    );
    await waitFor(() =>
      expect(window.localStatus.repositories.revert).toHaveBeenCalledWith(
        "changed-web",
        {
          scope: "unstaged",
          paths: [
            "src/App.tsx",
            "src/Details.tsx",
            "src/NewPanel.tsx",
          ],
        },
      ),
    );

    fireEvent.click(await screen.findByTitle("src/Details.tsx"));
    expect(document.querySelectorAll(".change-row.is-selected")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Stage src/Details.tsx" }),
    ).toBeVisible();
  });

  it("uses Command-clicked files for non-contiguous row actions", async () => {
    const batchChanges: ChangeItem[] = [
      {
        id: "working:src/App.tsx",
        path: "src/App.tsx",
        previousPath: null,
        scope: "working",
        kind: "modified",
        status: "M",
      },
      {
        id: "working:src/Details.tsx",
        path: "src/Details.tsx",
        previousPath: null,
        scope: "working",
        kind: "modified",
        status: "M",
      },
      {
        id: "untracked:src/NewPanel.tsx",
        path: "src/NewPanel.tsx",
        previousPath: null,
        scope: "untracked",
        kind: "untracked",
        status: "?",
      },
    ];
    vi.mocked(window.localStatus.repositories.changes).mockResolvedValue({
      repositoryId: "changed-web",
      changes: batchChanges,
    });
    vi.mocked(window.localStatus.repositories.stage).mockResolvedValue({
      repositoryId: "changed-web",
      changes: batchChanges,
    });
    render(<App />);

    const first = await screen.findByTitle("src/App.tsx");
    const middle = await screen.findByTitle("src/Details.tsx");
    const last = await screen.findByTitle("src/NewPanel.tsx");
    fireEvent.click(first);
    fireEvent.click(last, { metaKey: true });

    expect(document.querySelectorAll(".change-row.is-selected")).toHaveLength(2);
    expect(middle.closest(".change-row")).not.toHaveClass("is-selected");
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Stage 2 selected files",
      })[1],
    );
    await waitFor(() =>
      expect(window.localStatus.repositories.stage).toHaveBeenCalledWith(
        "changed-web",
        {
          scope: "unstaged",
          paths: ["src/App.tsx", "src/NewPanel.tsx"],
        },
      ),
    );

    fireEvent.click(first, { metaKey: true });
    expect(document.querySelectorAll(".change-row.is-selected")).toHaveLength(1);
    expect(last.closest(".change-row")).toHaveClass("is-selected");
  });

  it("explains how to resolve a sync blocked by local changes", async () => {
    const user = userEvent.setup();
    window.localStatus.repositories.sync = vi.fn(async () => {
      throw new Error(
        "Error invoking remote method 'repositories:sync': GitServiceError: error: Your local changes to the following files would be overwritten by merge:",
      );
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sync changes: 2 incoming, 1 outgoing",
      }),
    );

    expect(
      await screen.findByText(
        "Sync stopped to protect your local changes. Commit, revert, or stash the affected files, then try Sync again.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Stash changes" }),
    ).toBeVisible();
  });

  it("offers an explicit rebase or merge flow when sync histories diverge", async () => {
    const user = userEvent.setup();
    window.localStatus.repositories.sync = vi.fn(
      async (repositoryId, strategy) =>
        strategy
          ? {
              outcome: "synced" as const,
              repositoryId,
              upstream: "origin/feature",
              pulled: 2,
              pushed: strategy === "merge" ? 2 : 1,
              incoming: 0,
              outgoing: 0,
              syncedAt: new Date().toISOString(),
            }
          : {
              outcome: "diverged" as const,
              repositoryId,
              branch: "feature",
              upstream: "origin/feature",
              incoming: 2,
              outgoing: 1,
              workingTreeDirty: false,
            },
    );
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sync changes: 2 incoming, 1 outgoing",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Local and remote histories diverged",
    });
    expect(dialog).toBeVisible();
    expect(screen.getByRole("radio", { name: /Rebase/ })).toBeChecked();
    expect(within(dialog).getByText("2 incoming")).toBeVisible();
    expect(within(dialog).getByText("1 outgoing")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: /Merge/ }));
    await user.click(screen.getByRole("button", { name: "Merge and sync" }));

    await waitFor(() =>
      expect(window.localStatus.repositories.sync).toHaveBeenLastCalledWith(
        "changed-web",
        "merge",
      ),
    );
    expect(
      await screen.findByText("Synced changed-web: pulled 2, pushed 2."),
    ).toBeVisible();
  });

  it("blocks divergence recovery until working changes are stashed or committed", async () => {
    const user = userEvent.setup();
    window.localStatus.repositories.sync = vi.fn(async (repositoryId) => ({
      outcome: "diverged" as const,
      repositoryId,
      branch: "feature",
      upstream: "origin/feature",
      incoming: 2,
      outgoing: 1,
      workingTreeDirty: true,
    }));
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sync changes: 2 incoming, 1 outgoing",
      }),
    );

    expect(
      await screen.findByText("Working changes need a safe place first"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Rebase and sync" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Stash changes" }));
    const stashDialog = await screen.findByRole("dialog", {
      name: "Stash changes",
    });
    expect(stashDialog).toBeVisible();
    await user.click(
      within(stashDialog).getByRole("button", {
        name: "Close stash window",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Local and remote histories diverged",
      }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Stash changes" }));
    const reopenedStash = await screen.findByRole("dialog", {
      name: "Stash changes",
    });
    await user.click(
      within(reopenedStash).getByRole("button", { name: "Stash changes" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Local and remote histories diverged",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Rebase and sync" }),
    ).toBeEnabled();
  });

  it("guides a paused rebase and opens an interactive AI conflict terminal", async () => {
    const user = userEvent.setup();
    window.localStatus.repositories.sync = vi.fn(async (repositoryId) => ({
      outcome: "paused" as const,
      repositoryId,
      operation: "rebase" as const,
      branch: "feature",
      upstream: "origin/feature",
      conflictFiles: ["src/App.tsx", "src/Details.tsx"],
      incoming: 2,
      outgoing: 1,
    }));
    window.localStatus.ai.startConflictResolution = vi.fn(async () => ({
      id: "conflict-terminal",
      repositoryId: "changed-web",
      title: "Resolve conflicts with Codex",
      kind: "shell" as const,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      signal: null,
      truncated: false,
      buffer: "",
    }));
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sync changes: 2 incoming, 1 outgoing",
      }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "Resolve conflicts to continue",
      }),
    ).toBeVisible();
    expect(screen.getByText("git rebase --continue")).toBeVisible();
    expect(screen.getByText("git rebase --abort")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Resolve and stage with Codex" }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "Resolve conflicts with Codex",
      }),
    ).toBeVisible();
    expect(window.localStatus.ai.startConflictResolution).toHaveBeenCalledWith({
      repositoryId: "changed-web",
      provider: "codex",
    });
  });

  it("keeps a paused operation recoverable after opening the conflict view", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    bridge.repositories.list = vi.fn(
      async () =>
        ({
          ...repositories,
          repositories: repositories.repositories.map((repository) =>
            repository.id === "changed-web"
              ? {
                  ...repository,
                  operation: "rebase" as const,
                  summary: {
                    ...repository.summary,
                    files: 1,
                    conflicts: 1,
                  },
                }
              : repository,
          ),
        }) as unknown as Awaited<
          ReturnType<LocalStatusBridge["repositories"]["list"]>
        >,
    );
    bridge.repositories.changes = vi.fn(async () => ({
      repositoryId: "changed-web",
      changes: [
        {
          id: "conflict:src/App.tsx",
          path: "src/App.tsx",
          previousPath: null,
          scope: "conflict" as const,
          kind: "modified" as const,
          status: "UU",
        },
      ],
    }));
    window.localStatus = bridge;
    render(<App />);

    const recovery = await screen.findByRole("region", {
      name: "Rebase recovery",
    });
    expect(within(recovery).getByText("1 conflicted file needs resolution")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Resume rebase recovery: 1 conflicts",
      }),
    ).toBeVisible();
    for (const branchControl of screen.getAllByRole("button", {
      name: "Rebase paused for changed-web",
    })) {
      expect(branchControl).toBeDisabled();
    }

    await user.click(
      within(recovery).getByRole("button", { name: "Recovery details" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Resolve conflicts to continue",
    });
    const viewConflicts = within(dialog).getByRole("button", {
      name: "View conflicts",
    });
    expect(viewConflicts).toHaveFocus();
    await user.click(viewConflicts);

    expect(
      await screen.findByRole("region", { name: "Rebase recovery" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Mark resolved src/App.tsx" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Resume rebase recovery: 1 conflicts",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Resolve conflicts to continue",
      }),
    ).toBeVisible();
    expect(bridge.repositories.sync).not.toHaveBeenCalled();
  });

  it("opens AI resolution directly from paused recovery context", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    bridge.repositories.list = vi.fn(
      async () =>
        ({
          ...repositories,
          repositories: repositories.repositories.map((repository) =>
            repository.id === "changed-web"
              ? {
                  ...repository,
                  operation: "merge" as const,
                  summary: {
                    ...repository.summary,
                    files: 1,
                    conflicts: 1,
                  },
                }
              : repository,
          ),
        }) as unknown as Awaited<
          ReturnType<LocalStatusBridge["repositories"]["list"]>
        >,
    );
    bridge.repositories.changes = vi.fn(async () => ({
      repositoryId: "changed-web",
      changes: [
        {
          id: "conflict:src/App.tsx",
          path: "src/App.tsx",
          previousPath: null,
          scope: "conflict" as const,
          kind: "modified" as const,
          status: "UU",
        },
      ],
    }));
    bridge.ai.startConflictResolution = vi.fn(async () => ({
      id: "conflict-terminal",
      repositoryId: "changed-web",
      title: "Resolve conflicts with Codex",
      kind: "shell" as const,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      signal: null,
      truncated: false,
      buffer: "",
    }));
    window.localStatus = bridge;
    render(<App />);

    const recovery = await screen.findByRole("region", {
      name: "Merge recovery",
    });
    await user.click(
      await within(recovery).findByRole("button", {
        name: "Resolve with Codex",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Resolve conflicts with Codex",
      }),
    ).toBeVisible();
    expect(bridge.ai.startConflictResolution).toHaveBeenCalledWith({
      repositoryId: "changed-web",
      provider: "codex",
    });
  });

  it("prefills continue without executing it when paused conflicts are staged", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    bridge.repositories.list = vi.fn(
      async () =>
        ({
          ...repositories,
          repositories: repositories.repositories.map((repository) =>
            repository.id === "changed-web"
              ? {
                  ...repository,
                  operation: "rebase" as const,
                  summary: {
                    ...repository.summary,
                    files: 1,
                    staged: 1,
                    conflicts: 0,
                  },
                }
              : repository,
          ),
        }) as unknown as Awaited<
          ReturnType<LocalStatusBridge["repositories"]["list"]>
        >,
    );
    bridge.repositories.changes = vi.fn(async () => ({
      repositoryId: "changed-web",
      changes: [
        {
          id: "staged:src/App.tsx",
          path: "src/App.tsx",
          previousPath: null,
          scope: "staged" as const,
          kind: "modified" as const,
          status: "M",
        },
      ],
    }));
    window.localStatus = bridge;
    render(<App />);

    const recovery = await screen.findByRole("region", {
      name: "Rebase recovery",
    });
    expect(
      within(recovery).getByText(
        "All conflicts are staged and Git is ready to continue",
      ),
    ).toBeVisible();
    await user.click(
      within(recovery).getByRole("button", {
        name: "Continue in terminal",
      }),
    );

    expect(bridge.terminals.create).toHaveBeenCalledWith({
      repositoryId: "changed-web",
      kind: "shell",
    });
    expect(bridge.terminals.rename).toHaveBeenCalledWith(
      "terminal-1",
      "changed-web · Sync recovery",
    );
    expect(bridge.terminals.write).toHaveBeenCalledWith(
      "terminal-1",
      "git rebase --continue",
    );
  });

  it("creates bulk and per-file stashes with clear defaults", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /^Stash$/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Stash changes" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /Include untracked files/ }),
    ).toBeChecked();
    await user.type(
      screen.getByPlaceholderText("What are you saving?"),
      "before sync",
    );
    await user.click(screen.getByRole("button", { name: "Stash changes" }));
    expect(window.localStatus.repositories.createStash).toHaveBeenCalledWith(
      "changed-web",
      {
        message: "before sync",
        includeUntracked: true,
        path: null,
      },
    );
    expect(await screen.findByRole("button", { name: "View stash" })).toBeVisible();

    cleanup();
    window.localStatus = createBridge();
    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "Stash all changes for src/App.tsx",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Stash this file" }),
    ).toBeVisible();
    expect(screen.getByText("src/App.tsx")).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: /Include untracked files/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stash file" }));
    expect(window.localStatus.repositories.createStash).toHaveBeenCalledWith(
      "changed-web",
      {
        message: "",
        includeUntracked: true,
        path: "src/App.tsx",
      },
    );
  });

  it("browses stash files and exposes apply, pop, and delete actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Stashes" }));
    const stashRow = await screen.findByRole("button", {
      name: /checkpoint.*feature.*stash@\{0\}/i,
    });
    await user.click(stashRow);
    expect(await screen.findByRole("heading", { name: "checkpoint" })).toBeVisible();
    expect(screen.getByText("2 saved files")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(window.localStatus.repositories.applyStash).toHaveBeenCalledWith(
      "changed-web",
      "e".repeat(40),
    );

    await user.click(screen.getByRole("button", { name: "Pop" }));
    expect(window.localStatus.repositories.popStash).toHaveBeenCalledWith(
      "changed-web",
      "e".repeat(40),
    );
  });

  it("groups tracked and untracked files together as unstaged changes", async () => {
    render(<App />);

    expect(await screen.findByText("Unstaged")).toBeVisible();
    expect(screen.queryByText("Not staged")).not.toBeInTheDocument();
    expect(screen.queryByText("Working tree")).not.toBeInTheDocument();
    expect(screen.queryByText("Untracked")).not.toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeVisible();
    expect(screen.getByText("NewPanel.tsx")).toBeVisible();
  });

  it("finishes loading changes when a repository refresh supersedes the initial request", async () => {
    type ChangesResponse = Awaited<
      ReturnType<LocalStatusBridge["repositories"]["changes"]>
    >;
    let resolveInitialChanges!: (response: ChangesResponse) => void;
    const initialChanges = new Promise<ChangesResponse>((resolve) => {
      resolveInitialChanges = resolve;
    });
    vi.mocked(
      window.localStatus.repositories.changes,
    ).mockImplementationOnce(() => initialChanges);

    render(<App />);

    await waitFor(() =>
      expect(window.localStatus.repositories.changes).toHaveBeenCalledOnce(),
    );
    expect(screen.getByLabelText("Loading")).toBeVisible();

    vi.mocked(window.localStatus.repositories.list).mockResolvedValueOnce(
      {
        ...repositories,
        generatedAt: "2099-01-01T00:00:00.000Z",
      } as unknown as Awaited<
        ReturnType<LocalStatusBridge["repositories"]["list"]>
      >,
    );
    fireEvent.focus(window);

    await waitFor(() =>
      expect(window.localStatus.repositories.changes).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByText("Unstaged")).toBeVisible();
    expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument();

    resolveInitialChanges({
      repositoryId: "changed-web",
      changes: [],
    });
  });

  it("automatically dismisses change confirmations", async () => {
    render(<App />);

    const stageAllButton = await screen.findByRole("button", {
      name: "Stage all unstaged changes",
    });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(stageAllButton);
        await Promise.resolve();
      });

      expect(window.localStatus.repositories.stage).toHaveBeenCalledWith(
        "changed-web",
        { scope: "unstaged" },
      );
      expect(screen.getByText("Staged all unstaged changes.")).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      expect(
        screen.queryByText("Staged all unstaged changes."),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens an accessible staged-only commit window and drafts with Codex", async () => {
    const user = userEvent.setup();
    render(<App />);

    const commitButton = await screen.findByRole("button", { name: "Commit" });
    expect(commitButton).toBeDisabled();
    expect(commitButton).toHaveAttribute(
      "title",
      "Stage changes before committing",
    );

    await user.click(
      await screen.findByRole("button", { name: "Stage src/App.tsx" }),
    );
    expect(commitButton).toBeEnabled();
    await user.click(commitButton);

    const dialog = await screen.findByRole("dialog", {
      name: "Commit staged changes",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const message = within(dialog).getByRole("textbox", {
      name: "Commit message",
    });
    expect(message).toHaveFocus();
    expect(within(dialog).getByText("src/App.tsx")).toBeVisible();
    expect(within(dialog).queryByLabelText("Provider")).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "AI draft settings" }),
    );
    expect(within(dialog).getByLabelText("Provider")).toHaveValue("codex");
    expect(within(dialog).getByLabelText("Model")).toHaveValue(
      "gpt-5.6-luna",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Model"),
      "gpt-5.6-sol",
    );
    expect(window.localStatus.ai.setPreferences).toHaveBeenCalledWith(
      "codex",
      "gpt-5.6-sol",
    );
    await user.click(message);
    expect(within(dialog).queryByLabelText("Provider")).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Generate with Codex" }),
    );
    await waitFor(() =>
      expect(message).toHaveValue("feat: generated commit"),
    );
    expect(window.localStatus.ai.acceptDisclosure).toHaveBeenCalledWith("codex");
    expect(window.localStatus.ai.generateCommitMessage).toHaveBeenCalledWith({
      repositoryId: "changed-web",
      snapshotId: "c".repeat(64),
      requestId: expect.any(String),
    });

    await user.clear(message);
    await user.type(message, "feat: reviewed generated commit");
    await user.click(within(dialog).getByRole("button", { name: "Commit" }));
    expect(window.localStatus.repositories.createCommit).toHaveBeenCalledWith(
      "changed-web",
      {
        message: "feat: reviewed generated commit",
        snapshotId: "c".repeat(64),
      },
    );
    expect(
      await screen.findByText("Committed ddddddd: feat: generated commit"),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("installs a missing Claude CLI in a managed terminal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Stage src/App.tsx" }),
    );
    await user.click(screen.getByRole("button", { name: "Commit" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Commit staged changes",
    });

    await user.click(
      within(dialog).getByRole("button", { name: "AI draft settings" }),
    );
    await user.selectOptions(within(dialog).getByLabelText("Provider"), "claude");

    expect(window.localStatus.ai.setPreferences).toHaveBeenCalledWith(
      "claude",
      "haiku",
    );
    expect(
      await within(dialog).findByRole("button", {
        name: "Install Claude CLI",
      }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Locate existing" }),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Model")).toHaveValue("haiku");
    const message = within(dialog).getByLabelText("Commit message");
    await user.type(message, "Keep this draft in place");

    await user.click(
      within(dialog).getByRole("button", { name: "Install Claude CLI" }),
    );

    expect(window.localStatus.terminals.create).toHaveBeenCalledWith({
      repositoryId: "changed-web",
      kind: "shell",
    });
    expect(window.localStatus.terminals.rename).toHaveBeenCalledWith(
      "terminal-1",
      "Install Claude CLI",
    );
    expect(window.localStatus.terminals.write).toHaveBeenCalledWith(
      "terminal-1",
      'curl -fsSL https://claude.ai/install.sh | bash && "$HOME/.local/bin/claude" auth login --claudeai\r',
    );
    expect(
      await screen.findByRole("dialog", { name: "Install Claude CLI" }),
    ).toBeVisible();
    expect(screen.getByTestId("terminal-pane")).toHaveAttribute(
      "data-autofocus",
      "true",
    );
    fireEvent.keyDown(screen.getByTestId("terminal-pane"), { key: "Escape" });
    expect(
      screen.getByRole("dialog", { name: "Install Claude CLI" }),
    ).toBeVisible();
    const setupClose = screen.getByRole("button", {
      name: "Close setup terminal",
    });
    setupClose.focus();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(screen.getByTestId("terminal-pane")).toHaveAttribute(
      "data-find-request",
      "1",
    );
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(setupClose).toHaveFocus();
    expect(
      screen.queryByRole("heading", { name: "Services & terminals" }),
    ).not.toBeInTheDocument();
    expect(dialog).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "Install Claude CLI" }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("dialog", { name: "Commit staged changes" }),
      ).getByLabelText("Commit message"),
    ).toHaveValue("Keep this draft in place");
  });

  it("closes the commit window with Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Stage src/App.tsx" }),
    );
    const commitButton = screen.getByRole("button", { name: "Commit" });
    await user.click(commitButton);
    const dialog = await screen.findByRole("dialog", {
      name: "Commit staged changes",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "AI draft settings" }),
    );
    expect(within(dialog).getByLabelText("Provider")).toBeVisible();

    await user.keyboard("{Escape}");

    expect(within(dialog).queryByLabelText("Provider")).not.toBeInTheDocument();
    expect(dialog).toBeVisible();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(commitButton).toHaveFocus();
  });
});
