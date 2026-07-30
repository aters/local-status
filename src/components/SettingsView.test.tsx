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
    render(<SettingsView theme="green" onThemeChange={onThemeChange} />);

    const choices = screen.getAllByRole("radio");
    expect(choices).toHaveLength(6);
    expect(screen.getByRole("radio", { name: /^Glass\b/ })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Neumorphic/ })).toBeVisible();
    expect(screen.getByRole("radio", { name: /^Liquid Glass\b/ })).toBeVisible();
    expect(screen.getByText("Follows system")).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: /^Liquid Glass\b/ }));
    await waitFor(() =>
      expect(onThemeChange).toHaveBeenCalledWith("liquid-glass"),
    );
  });

  it("reports persistence failures and re-enables the choices", async () => {
    const onThemeChange = vi.fn().mockRejectedValue(new Error("Disk unavailable"));
    render(<SettingsView theme="green" onThemeChange={onThemeChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /Neumorphic/ }));

    expect(await screen.findByText("Disk unavailable")).toBeVisible();
    expect(screen.getByRole("radio", { name: /^Glass\b/ })).toBeEnabled();
  });
});
