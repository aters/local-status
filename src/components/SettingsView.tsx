import { Check, Leaf, Moon, Sun } from "lucide-react";
import { useState } from "react";
import type { Theme } from "../types";

const themes: Array<{
  id: Theme;
  name: string;
  description: string;
  Icon: typeof Leaf;
}> = [
  {
    id: "green",
    name: "Green",
    description: "The original Local Status palette.",
    Icon: Leaf,
  },
  {
    id: "dark",
    name: "Dark",
    description: "Neutral charcoal surfaces with soft contrast.",
    Icon: Moon,
  },
  {
    id: "light",
    name: "Light",
    description: "Bright surfaces for daylight environments.",
    Icon: Sun,
  },
];

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
          {themes.map(({ id, name, description, Icon }) => (
            <button
              className={`theme-card ${theme === id ? "is-selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={theme === id}
              disabled={saving !== null}
              key={id}
              onClick={() => void selectTheme(id)}
            >
              <span className={`theme-preview theme-preview--${id}`}>
                <span />
                <span />
                <span />
              </span>
              <span className="theme-card__copy">
                <span>
                  <Icon size={17} />
                  <strong>{name}</strong>
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
