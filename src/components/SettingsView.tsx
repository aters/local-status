import { Check, Layers3, Leaf, Moon, Sparkles, Sun, Waves } from "lucide-react";
import { useState } from "react";
import {
  THEME_DEFINITIONS,
  THEME_IDS,
} from "../theme";
import type { AppearanceMode, Theme } from "../types";

const themeIcons: Record<Theme, typeof Leaf> = {
  green: Leaf,
  dark: Moon,
  light: Sun,
  glass: Sparkles,
  neumorphic: Layers3,
  "liquid-glass": Waves,
};

const themes = THEME_IDS.map((id) => ({
  ...THEME_DEFINITIONS[id],
  Icon: themeIcons[id],
}));

const appearanceModes: Array<{
  id: AppearanceMode;
  label: string;
}> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function SettingsView({
  theme,
  liquidGlassAppearance,
  onThemeChange,
  onLiquidGlassAppearanceChange,
}: {
  theme: Theme;
  liquidGlassAppearance: AppearanceMode;
  onThemeChange: (theme: Theme) => Promise<void>;
  onLiquidGlassAppearanceChange: (
    appearance: AppearanceMode,
  ) => Promise<void>;
}) {
  const [savingTheme, setSavingTheme] = useState<Theme | null>(null);
  const [savingAppearance, setSavingAppearance] =
    useState<AppearanceMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = savingTheme !== null || savingAppearance !== null;

  async function selectTheme(next: Theme) {
    if (next === theme || saving) return;
    setSavingTheme(next);
    setError(null);
    try {
      await onThemeChange(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the theme.",
      );
    } finally {
      setSavingTheme(null);
    }
  }

  async function selectLiquidGlassAppearance(next: AppearanceMode) {
    if (next === liquidGlassAppearance || saving) return;
    setSavingAppearance(next);
    setError(null);
    try {
      await onLiquidGlassAppearanceChange(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save the Liquid Glass appearance.",
      );
    } finally {
      setSavingAppearance(null);
    }
  }

  return (
    <main className="settings-page">
      <section className="settings-heading">
        <p className="eyebrow">Preferences</p>
        <h1>Settings</h1>
        <p>Personalize Local Status without changing your repositories.</p>
      </section>
      <section className="settings-section" aria-labelledby="appearance-title">
        <div>
          <h2 id="appearance-title">Appearance</h2>
          <p>Choose the palette used across the app, diffs, and terminals.</p>
        </div>
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {themes.map(({ id, label, description, material, layout, Icon }) => {
            const selected = theme === id;
            return (
              <article
                className={`theme-card ${selected ? "is-selected" : ""}`}
                key={id}
              >
                <button
                  className="theme-card__select"
                  type="button"
                  role="radio"
                  aria-label={`${label} theme`}
                  aria-checked={selected}
                  disabled={saving}
                  onClick={() => void selectTheme(id)}
                >
                  <span
                    className={`theme-preview theme-preview--${id}`}
                    data-material={material}
                    data-layout={layout}
                    data-appearance={
                      id === "liquid-glass"
                        ? liquidGlassAppearance
                        : undefined
                    }
                  >
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="theme-card__copy">
                    <span>
                      <Icon size={17} />
                      <strong>{label}</strong>
                    </span>
                    <small>{description}</small>
                  </span>
                  {selected && (
                    <span className="theme-card__check" aria-hidden="true">
                      <Check size={14} />
                    </span>
                  )}
                </button>
                {id === "liquid-glass" && (
                  <div
                    className="theme-appearance-switch"
                    role="radiogroup"
                    aria-label="Liquid Glass appearance"
                  >
                    {appearanceModes.map((mode) => (
                      <button
                        className={
                          liquidGlassAppearance === mode.id ? "is-active" : ""
                        }
                        type="button"
                        role="radio"
                        aria-checked={liquidGlassAppearance === mode.id}
                        disabled={saving}
                        key={mode.id}
                        onClick={() =>
                          void selectLiquidGlassAppearance(mode.id)
                        }
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {error && <div className="settings-error">{error}</div>}
      </section>
    </main>
  );
}
