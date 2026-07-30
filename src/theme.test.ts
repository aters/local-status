import { describe, expect, it } from "vitest";
import { MONACO_THEMES } from "./editor-themes";
import {
  applyThemeAttributes,
  browserSystemAppearance,
  DEFAULT_THEME,
  normalizeTheme,
  resolveColorScheme,
  THEME_DEFINITIONS,
  THEME_IDS,
} from "./theme";
import { TERMINAL_THEMES } from "./terminal-themes";

describe("theme registry", () => {
  it("contains unique, internally consistent definitions", () => {
    expect(THEME_IDS).toEqual([
      "green",
      "dark",
      "light",
      "glass",
      "neumorphic",
      "liquid-glass",
    ]);
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    for (const id of THEME_IDS) {
      expect(THEME_DEFINITIONS[id].id).toBe(id);
      expect(THEME_DEFINITIONS[id].label).toBeTruthy();
      expect(THEME_DEFINITIONS[id].description).toBeTruthy();
    }
  });

  it("normalizes unknown saved values to the default", () => {
    expect(normalizeTheme("glass")).toBe("glass");
    expect(normalizeTheme("neumorphic")).toBe("neumorphic");
    expect(normalizeTheme("liquid-glass")).toBe("liquid-glass");
    expect(normalizeTheme("unknown")).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
  });

  it("applies palette, material, layout, and color scheme together", () => {
    applyThemeAttributes("glass", {
      colorScheme: "light",
      reducedTransparency: true,
      highContrast: true,
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "glass");
    expect(document.documentElement).toHaveAttribute("data-material", "glass");
    expect(document.documentElement).toHaveAttribute("data-layout", "floating");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement).toHaveAttribute(
      "data-reduced-transparency",
      "true",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-high-contrast",
      "true",
    );

    applyThemeAttributes("liquid-glass", {
      colorScheme: "light",
      reducedTransparency: false,
      highContrast: false,
    });
    expect(document.documentElement).toHaveAttribute(
      "data-material",
      "liquid-glass",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-layout",
      "immersive",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-color-scheme",
      "light",
    );
    expect(document.documentElement.style.colorScheme).toBe("light");

    applyThemeAttributes("light", {
      colorScheme: "dark",
      reducedTransparency: false,
      highContrast: false,
    });
    expect(document.documentElement).toHaveAttribute("data-material", "flat");
    expect(document.documentElement).toHaveAttribute("data-layout", "edge");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("resolves system themes without changing fixed themes", () => {
    const darkAppearance = {
      colorScheme: "dark" as const,
      reducedTransparency: false,
      highContrast: false,
    };
    expect(resolveColorScheme("liquid-glass", darkAppearance)).toBe("dark");
    expect(resolveColorScheme("light", darkAppearance)).toBe("light");
    expect(browserSystemAppearance()).toMatchObject({
      reducedTransparency: false,
    });
  });

  it("provides editor and terminal definitions for every theme", () => {
    expect(Object.keys(MONACO_THEMES)).toEqual(THEME_IDS);
    expect(Object.keys(TERMINAL_THEMES)).toEqual(THEME_IDS);
    for (const id of THEME_IDS) {
      expect(THEME_DEFINITIONS[id].windowBackground.light).toBeTruthy();
      expect(THEME_DEFINITIONS[id].windowBackground.dark).toBeTruthy();
      for (const scheme of ["light", "dark"] as const) {
        expect(
          MONACO_THEMES[id][scheme].colors["editor.background"],
        ).toBeTruthy();
        expect(TERMINAL_THEMES[id][scheme].background).toBeTruthy();
      }
    }
    expect(
      MONACO_THEMES["liquid-glass"].light.colors["editor.background"],
    ).not.toBe(
      MONACO_THEMES["liquid-glass"].dark.colors["editor.background"],
    );
    expect(TERMINAL_THEMES["liquid-glass"].light.background).not.toBe(
      TERMINAL_THEMES["liquid-glass"].dark.background,
    );
  });
});
