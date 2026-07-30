import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalStatusBridge, TerminalSession } from "../types";
import { TerminalPane } from "./TerminalPane";

const terminalMocks = vi.hoisted(() => ({
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  focus: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    write() {}
    writeln() {}
    focus() {
      terminalMocks.focus();
    }
    onData() {
      return { dispose: vi.fn() };
    }
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext(...args: unknown[]) {
      terminalMocks.findNext(...args);
    }
    findPrevious(...args: unknown[]) {
      terminalMocks.findPrevious(...args);
    }
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

const session: TerminalSession = {
  id: "terminal-1",
  repositoryId: "web",
  title: "Web terminal",
  kind: "shell",
  status: "running",
  startedAt: new Date().toISOString(),
  endedAt: null,
  exitCode: null,
  signal: null,
  truncated: false,
  buffer: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.localStatus = {
    terminals: {
      write: vi.fn(),
      resize: vi.fn(),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
    },
    system: {
      openLocalUrl: vi.fn(),
    },
  } as unknown as LocalStatusBridge;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TerminalPane find", () => {
  it("opens from a find request, searches forward/backward, and restores focus", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TerminalPane session={session} findRequest={0} />,
    );

    rerender(<TerminalPane session={session} findRequest={1} />);
    const search = await screen.findByRole("textbox", {
      name: "Search terminal output",
    });
    expect(search).toHaveFocus();

    await user.type(search, "needle");
    expect(terminalMocks.findNext).toHaveBeenLastCalledWith("needle", {
      incremental: true,
    });
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(terminalMocks.findPrevious).toHaveBeenCalledWith("needle");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(terminalMocks.focus).toHaveBeenCalled());
    expect(
      screen.queryByRole("textbox", { name: "Search terminal output" }),
    ).not.toBeInTheDocument();
  });
});
