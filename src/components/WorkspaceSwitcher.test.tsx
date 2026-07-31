import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const current = { name: "engineering", path: "/Users/developer/work/engineering" };
const recent = [
  current,
  { name: "client-apps", path: "/Users/developer/work/client-apps" },
  { name: "platform", path: "/Users/developer/archive/platform" },
  { name: "client-apps", path: "/Users/developer/work/client-apps" },
];

afterEach(() => cleanup());

function renderSwitcher(
  overrides: Partial<Parameters<typeof WorkspaceSwitcher>[0]> = {},
) {
  const props: Parameters<typeof WorkspaceSwitcher>[0] = {
    current,
    rootKind: "workspace",
    recent,
    busy: false,
    error: null,
    onChoose: vi.fn(async () => true),
    onOpenRecent: vi.fn(async () => true),
    onClearError: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkspaceSwitcher {...props} />), props };
}

describe("WorkspaceSwitcher", () => {
  it("shows the current workspace once and deduplicates recent workspaces", async () => {
    const user = userEvent.setup();
    const { props } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: "engineering" }));

    const menu = screen.getByRole("menu", {
      name: "Switch repository or workspace",
    });
    expect(within(menu).getAllByText("engineering")).toHaveLength(1);
    expect(within(menu).getAllByText("client-apps")).toHaveLength(1);
    expect(within(menu).getByText(current.path, { exact: false })).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: /engineering/i }),
    ).toHaveAttribute("aria-current", "true");

    await user.click(within(menu).getByRole("menuitem", { name: /client-apps/i }));

    expect(props.onOpenRecent).toHaveBeenCalledWith(
      "/Users/developer/work/client-apps",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", {
          name: "Switch repository or workspace",
        }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "engineering" })).toHaveFocus(),
    );
  });

  it("supports arrow navigation, Add workspace, and Escape focus restoration", async () => {
    const user = userEvent.setup();
    const { props } = renderSwitcher();
    const trigger = screen.getByRole("button", { name: "engineering" });

    trigger.focus();
    await user.keyboard("{ArrowDown}");

    const menu = screen.getByRole("menu", {
      name: "Switch repository or workspace",
    });
    const client = within(menu).getByRole("menuitem", { name: /client-apps/i });
    const platform = within(menu).getByRole("menuitem", { name: /platform/i });
    const add = within(menu).getByRole("menuitem", {
      name: "Open repository or workspace…",
    });
    await waitFor(() => expect(client).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    expect(platform).toHaveFocus();
    await user.keyboard("{End}");
    expect(add).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.onChoose).toHaveBeenCalledOnce();

    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /client-apps/i }),
      ).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("dismisses on an outside pointer interaction", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: "engineering" }));
    expect(screen.getByRole("menu")).toBeVisible();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the menu and current workspace visible when a recent workspace fails", async () => {
    const user = userEvent.setup();

    function FailureHarness() {
      const [error, setError] = useState<string | null>(null);
      return (
        <WorkspaceSwitcher
          current={current}
          rootKind="workspace"
          recent={recent}
          busy={false}
          error={error}
          onChoose={async () => true}
          onOpenRecent={async () => {
            setError("That workspace is no longer available.");
            return false;
          }}
          onClearError={() => setError(null)}
        />
      );
    }

    render(<FailureHarness />);
    await user.click(screen.getByRole("button", { name: "engineering" }));
    await user.click(screen.getByRole("menuitem", { name: /client-apps/i }));

    expect(screen.getByRole("menu")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That workspace is no longer available.",
    );
    expect(
      screen.getByRole("menuitem", { name: /engineering/i }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("disables the trigger while a workspace is opening", () => {
    renderSwitcher({ busy: true });

    expect(screen.getByRole("button", { name: "engineering" })).toBeDisabled();
  });

  it("labels a directly opened Git root as a repository", async () => {
    const user = userEvent.setup();
    renderSwitcher({ rootKind: "repository" });

    await user.click(screen.getByRole("button", { name: "engineering" }));

    const menu = screen.getByRole("menu", {
      name: "Switch repository or workspace",
    });
    expect(within(menu).getByText("Repository")).toBeVisible();
    expect(
      within(menu).getByText(`Repository · ${current.path}`),
    ).toBeVisible();
  });

  it("labels a Git root with child repositories as a repository workspace", async () => {
    const user = userEvent.setup();
    renderSwitcher({ rootKind: "hybrid" });

    await user.click(screen.getByRole("button", { name: "engineering" }));

    const menu = screen.getByRole("menu", {
      name: "Switch repository or workspace",
    });
    expect(within(menu).getByText("Repository workspace")).toBeVisible();
    expect(
      within(menu).getByText(`Repository workspace · ${current.path}`),
    ).toBeVisible();
  });
});
