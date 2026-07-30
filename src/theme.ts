import manifest from "../shared/themes.json";

export type Theme = keyof typeof manifest;
export type ThemeMaterial = "flat" | "glass" | "neumorphic";
export type ThemeLayout = "edge" | "floating" | "sculpted";
export type ThemeColorScheme = "light" | "dark";

export interface ThemeDefinition {
  id: Theme;
  label: string;
  description: string;
  colorScheme: ThemeColorScheme;
  material: ThemeMaterial;
  layout: ThemeLayout;
}

export const DEFAULT_THEME: Theme = "green";

export const THEME_DEFINITIONS =
  manifest as Record<Theme, ThemeDefinition>;

export const THEME_IDS = Object.freeze(
  Object.keys(THEME_DEFINITIONS) as Theme[],
);

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && value in THEME_DEFINITIONS;
}

export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function getThemeDefinition(theme: Theme): ThemeDefinition {
  return THEME_DEFINITIONS[theme];
}

export function applyThemeAttributes(
  theme: Theme,
  root: HTMLElement = document.documentElement,
) {
  const definition = getThemeDefinition(theme);
  root.dataset.theme = theme;
  root.dataset.material = definition.material;
  root.dataset.layout = definition.layout;
  root.style.colorScheme = definition.colorScheme;
}
