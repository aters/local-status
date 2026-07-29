import {
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
  TerminalPane: () => <div data-testid="terminal-pane">Terminal</div>,
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
      summary: { files: 1, staged: 0, modified: 1, untracked: 0, conflicts: 0 },
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
      rename: vi.fn(),
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

  it("shows repository health, filters changes, and focuses global search", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("changed-web")).toBeInTheDocument();
    expect(screen.getByText("clean-api")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".status-badge--incoming" })).toBeVisible();

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
});
