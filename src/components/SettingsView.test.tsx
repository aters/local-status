import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

describe("SettingsView themes", () => {
  it("renders all six themes and saves a new selection", async () => {
    const onThemeChange = vi.fn().mockResolvedValue(undefined);
    const onLiquidGlassAppearanceChange = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsView
        theme="green"
        liquidGlassAppearance="system"
        onThemeChange={onThemeChange}
        onLiquidGlassAppearanceChange={onLiquidGlassAppearanceChange}
      />,
    );

    const choices = screen
      .getByRole("radiogroup", { name: "Theme" })
      .querySelectorAll(':scope > .theme-card > [role="radio"]');
    expect(choices).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "Glass theme" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Neumorphic theme" })).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "Liquid Glass theme" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Liquid Glass appearance" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();

    fireEvent.click(
      screen.getByRole("radio", { name: "Liquid Glass theme" }),
    );
    await waitFor(() =>
      expect(onThemeChange).toHaveBeenCalledWith("liquid-glass"),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(() =>
      expect(onLiquidGlassAppearanceChange).toHaveBeenCalledWith("dark"),
    );
  });

  it("reports persistence failures and re-enables the choices", async () => {
    const onThemeChange = vi.fn().mockRejectedValue(new Error("Disk unavailable"));
    render(
      <SettingsView
        theme="green"
        liquidGlassAppearance="system"
        onThemeChange={onThemeChange}
        onLiquidGlassAppearanceChange={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Neumorphic theme" }));

    expect(await screen.findByText("Disk unavailable")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Glass theme" })).toBeEnabled();
  });

  it("reports Liquid Glass appearance persistence failures", async () => {
    render(
      <SettingsView
        theme="liquid-glass"
        liquidGlassAppearance="system"
        onThemeChange={vi.fn().mockResolvedValue(undefined)}
        onLiquidGlassAppearanceChange={vi
          .fn()
          .mockRejectedValue(new Error("Appearance unavailable"))}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(await screen.findByText("Appearance unavailable")).toBeVisible();
    expect(screen.getByRole("radio", { name: "System" })).toBeEnabled();
  });
});
