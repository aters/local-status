import manifest from "../shared/themes.json";

export type Theme = keyof typeof manifest;
export type ThemeMaterial = "flat" | "glass" | "neumorphic" | "liquid-glass";
export type ThemeLayout = "edge" | "floating" | "sculpted" | "immersive";
export type ResolvedColorScheme = "light" | "dark";
export type ThemeColorScheme = ResolvedColorScheme | "system";
export type AppearanceMode = ThemeColorScheme;

export interface SystemAppearance {
  colorScheme: ResolvedColorScheme;
  reducedTransparency: boolean;
  highContrast: boolean;
}

export interface ThemeDefinition {
  id: Theme;
  label: string;
  description: string;
  colorScheme: ThemeColorScheme;
  material: ThemeMaterial;
  layout: ThemeLayout;
  windowBackground: Record<ResolvedColorScheme, string>;
}

export const DEFAULT_THEME: Theme = "green";
export const DEFAULT_APPEARANCE_MODE: AppearanceMode = "system";

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

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "light" || value === "dark" || value === "system";
}

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return isAppearanceMode(value) ? value : DEFAULT_APPEARANCE_MODE;
}

export function getThemeDefinition(theme: Theme): ThemeDefinition {
  return THEME_DEFINITIONS[theme];
}

export function browserSystemAppearance(): SystemAppearance {
  const matches = (query: string) =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches;
  return {
    colorScheme: matches("(prefers-color-scheme: dark)") ? "dark" : "light",
    reducedTransparency: false,
    highContrast: matches("(prefers-contrast: more)"),
  };
}

export function resolveColorScheme(
  theme: Theme,
  appearance: SystemAppearance,
  appearanceMode: AppearanceMode = DEFAULT_APPEARANCE_MODE,
): ResolvedColorScheme {
  const configured = getThemeDefinition(theme).colorScheme;
  if (configured !== "system") return configured;
  return appearanceMode === "system" ? appearance.colorScheme : appearanceMode;
}

export function applyThemeAttributes(
  theme: Theme,
  appearance: SystemAppearance = browserSystemAppearance(),
  appearanceMode: AppearanceMode = DEFAULT_APPEARANCE_MODE,
  root: HTMLElement = document.documentElement,
) {
  const definition = getThemeDefinition(theme);
  const colorScheme = resolveColorScheme(theme, appearance, appearanceMode);
  root.dataset.theme = theme;
  root.dataset.material = definition.material;
  root.dataset.layout = definition.layout;
  root.dataset.colorScheme = colorScheme;
  root.dataset.appearanceMode =
    definition.colorScheme === "system" ? appearanceMode : definition.colorScheme;
  root.dataset.reducedTransparency = String(appearance.reducedTransparency);
  root.dataset.highContrast = String(appearance.highContrast);
  root.style.colorScheme = colorScheme;
}
