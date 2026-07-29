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
});
