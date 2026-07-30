import { describe, expect, it } from "vitest";
import { MONACO_THEMES } from "./editor-themes";
import {
  applyThemeAttributes,
  DEFAULT_THEME,
  normalizeTheme,
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
    expect(normalizeTheme("unknown")).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
  });

  it("applies palette, material, layout, and color scheme together", () => {
    applyThemeAttributes("glass");
    expect(document.documentElement).toHaveAttribute("data-theme", "glass");
    expect(document.documentElement).toHaveAttribute("data-material", "glass");
    expect(document.documentElement).toHaveAttribute("data-layout", "floating");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    applyThemeAttributes("light");
    expect(document.documentElement).toHaveAttribute("data-material", "flat");
    expect(document.documentElement).toHaveAttribute("data-layout", "edge");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("provides editor and terminal definitions for every theme", () => {
    expect(Object.keys(MONACO_THEMES)).toEqual(THEME_IDS);
    expect(Object.keys(TERMINAL_THEMES)).toEqual(THEME_IDS);
    for (const id of THEME_IDS) {
      expect(MONACO_THEMES[id].colors["editor.background"]).toBeTruthy();
      expect(TERMINAL_THEMES[id].background).toBeTruthy();
    }
  });
});
