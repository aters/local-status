import { Check, Layers3, Leaf, Moon, Sparkles, Sun } from "lucide-react";
import { useState } from "react";
import {
  THEME_DEFINITIONS,
  THEME_IDS,
} from "../theme";
import type { Theme } from "../types";

const themeIcons: Record<Theme, typeof Leaf> = {
  green: Leaf,
  dark: Moon,
  light: Sun,
  glass: Sparkles,
  neumorphic: Layers3,
};

const themes = THEME_IDS.map((id) => ({
  ...THEME_DEFINITIONS[id],
  Icon: themeIcons[id],
}));

export function SettingsView({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => Promise<void>;
}) {
  const [saving, setSaving] = useState<Theme | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectTheme(next: Theme) {
    if (next === theme || saving) return;
    setSaving(next);
    setError(null);
    try {
      await onThemeChange(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the theme.",
      );
    } finally {
      setSaving(null);
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
          {themes.map(({ id, label, description, material, layout, Icon }) => (
            <button
              className={`theme-card ${theme === id ? "is-selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={theme === id}
              disabled={saving !== null}
              key={id}
              onClick={() => void selectTheme(id)}
            >
              <span
                className={`theme-preview theme-preview--${id}`}
                data-material={material}
                data-layout={layout}
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
              {theme === id && (
                <span className="theme-card__check" aria-hidden="true">
                  <Check size={14} />
                </span>
              )}
            </button>
          ))}
        </div>
        {error && <div className="settings-error">{error}</div>}
      </section>
    </main>
  );
}
