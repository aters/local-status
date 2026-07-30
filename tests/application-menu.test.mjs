// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applicationMenuTemplate } from "../electron/application-menu.mjs";

describe("native application menu", () => {
  it("keeps the standard page zoom commands in the custom View menu", () => {
    const viewMenu = applicationMenuTemplate().find(
      (item) => item.label === "View",
    );
    const roles = viewMenu.submenu
      .map((item) => item.role)
      .filter(Boolean);

    expect(roles).toEqual(
      expect.arrayContaining(["resetZoom", "zoomIn", "zoomOut"]),
    );
  });

  it("routes Find and Quick Open through the shortcut callback", () => {
    const shortcuts = [];
    const menu = applicationMenuTemplate((shortcut) => shortcuts.push(shortcut));
    const editMenu = menu.find((item) => item.label === "Edit");
    const goMenu = menu.find((item) => item.label === "Go");
    const find = editMenu.submenu.find((item) => item.label === "Find");
    const quickOpen = goMenu.submenu.find((item) => item.label === "Quick Open…");

    expect(find.accelerator).toBe("CmdOrCtrl+F");
    expect(quickOpen.accelerator).toBe("CmdOrCtrl+P");
    find.click();
    quickOpen.click();

    expect(shortcuts).toEqual(["find", "quick-open"]);
  });
});
