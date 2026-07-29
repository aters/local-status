import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comparison } from "../types";
import MonacoDiff from "./MonacoDiff";

const editorMocks = vi.hoisted(() => {
  const originalEditor = {
    revealLineInCenter: vi.fn(),
  };
  const modifiedEditor = {
    revealLineInCenter: vi.fn(),
  };
  const lineChanges = [
    {
      originalStartLineNumber: 42,
      originalEndLineNumber: 44,
      modifiedStartLineNumber: 38,
      modifiedEndLineNumber: 40,
    },
    {
      originalStartLineNumber: 88,
      originalEndLineNumber: 89,
      modifiedStartLineNumber: 82,
      modifiedEndLineNumber: 83,
    },
  ];
  const instance = {
    getLineChanges: vi.fn(() => lineChanges),
    getOriginalEditor: vi.fn(() => originalEditor),
    getModifiedEditor: vi.fn(() => modifiedEditor),
    onDidUpdateDiff: vi.fn((listener: () => void) => {
      listener();
      return { dispose: vi.fn() };
    }),
  };
  return { instance, modifiedEditor, originalEditor };
});

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    onMount,
  }: {
    onMount?: (instance: typeof editorMocks.instance) => void;
  }) => {
    onMount?.(editorMocks.instance);
    return <div data-testid="monaco-diff">Source comparison</div>;
  },
}));

vi.mock("../monaco", () => ({}));

function comparison(overrides: Partial<Comparison> = {}): Comparison {
  return {
    repositoryId: "docs",
    path: "README.md",
    previousPath: null,
    language: "markdown",
    original: {
      content: "# Previous",
      source: "index",
      label: "Index",
      binary: false,
      truncated: false,
      missing: false,
    },
    modified: {
      content: [
        "# Preview title",
        "",
        "- [x] Complete",
        "",
        "| Name | State |",
        "| --- | --- |",
        "| Local Status | Ready |",
        "",
        "![Remote image](https://example.com/image.png)",
        "",
        "[External link](https://example.com)",
        "",
        "<script>alert('unsafe')</script>",
      ].join("\n"),
      source: "working",
      label: "Working tree",
      binary: false,
      truncated: false,
      missing: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("Markdown preview", () => {
  it("reveals the first change when a comparison opens", async () => {
    render(<MonacoDiff comparison={comparison()} />);

    await waitFor(() => {
      expect(editorMocks.modifiedEditor.revealLineInCenter).toHaveBeenCalledWith(38);
      expect(editorMocks.originalEditor.revealLineInCenter).toHaveBeenCalledWith(42);
    });
  });

  it("toggles between source and a safe rendered preview", async () => {
    const user = userEvent.setup();
    render(<MonacoDiff comparison={comparison()} />);

    expect(screen.getByTestId("monaco-diff")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("heading", { name: "Preview title" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("Image: Remote image")).toBeVisible();
    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText("External link")).not.toHaveAttribute("href");
    expect(window.localStorage.getItem("local-status:markdown-preview")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByTestId("monaco-diff")).toBeVisible();
  });

  it("does not offer preview for non-Markdown files", () => {
    render(
      <MonacoDiff
        comparison={comparison({
          path: "src/index.ts",
          language: "typescript",
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });
});
