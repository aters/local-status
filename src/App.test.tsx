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
import type { LocalStatusBridge } from "./types";

vi.mock("./components/MonacoDiff", () => ({
  default: () => <div data-testid="diff-viewer">Side-by-side diff</div>,
}));

vi.mock("./components/TerminalPane", () => ({
  TerminalPane: ({ autoFocus }: { autoFocus?: boolean }) => (
    <div data-autofocus={String(Boolean(autoFocus))} data-testid="terminal-pane">
      Terminal
    </div>
  ),
}));

const repositories = {
  generatedAt: new Date().toISOString(),
  workspaceName: "engineering",
  repositories: [
    {
      id: "clean-api",
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
      comparison: vi.fn(),
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
      sync: vi.fn(async (repositoryId) => ({
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

    await user.click(await screen.findByRole("button", { name: "Choose workspace" }));

    expect((await screen.findAllByText("changed-web")).length).toBeGreaterThan(0);
    expect(window.localStatus.workspace.choose).toHaveBeenCalledOnce();
  });

  it("preserves fetched repositories when workspace selection is cancelled", async () => {
    const user = userEvent.setup();
    vi.mocked(window.localStatus.workspace.choose).mockResolvedValueOnce(null);
    render(<App />);

    expect(await screen.findByText("changed-web")).toBeInTheDocument();
    expect(window.localStatus.repositories.list).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: /engineering change/i }));

    await waitFor(() =>
      expect(window.localStatus.workspace.choose).toHaveBeenCalledOnce(),
    );
    expect(window.localStatus.repositories.list).toHaveBeenCalledOnce();
    expect(screen.getByText("changed-web")).toBeInTheDocument();
  });

  it("shows repository health, filters changes, and focuses global search", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("changed-web")).toBeInTheDocument();
    expect(screen.getByText("clean-api")).toBeInTheDocument();
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
    expect(screen.queryByText("Not fetched this session")).not.toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".status-badge--incoming" })).toBeVisible();
    expect(
      screen.getByRole("option", { name: /changed-web/ }),
    ).toHaveClass("repository-row--changed");
    expect(
      screen.getByRole("option", { name: /clean-api/ }),
    ).toHaveClass("repository-row--clean");

    const repositoryPanel = screen.getByRole("listbox", { name: "Repositories" });
    await user.click(screen.getByRole("button", { name: "changed" }));
    expect(within(repositoryPanel).queryByText("clean-api")).not.toBeInTheDocument();
    expect(within(repositoryPanel).getByText("changed-web")).toBeVisible();

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(screen.getByRole("textbox", { name: "Find a repository" })).toHaveFocus();
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
      screen.getByRole("option", { name: /changed-web feature/ }),
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

  it("groups tracked and untracked files together as unstaged changes", async () => {
    render(<App />);

    expect(await screen.findByText("Unstaged")).toBeVisible();
    expect(screen.queryByText("Not staged")).not.toBeInTheDocument();
    expect(screen.queryByText("Working tree")).not.toBeInTheDocument();
    expect(screen.queryByText("Untracked")).not.toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeVisible();
    expect(screen.getByText("NewPanel.tsx")).toBeVisible();
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
