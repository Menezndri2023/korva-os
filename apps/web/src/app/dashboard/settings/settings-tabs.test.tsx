import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SettingsTabPanel, SettingsTabs, useSettingsTab } from "./settings-tabs";

function Harness() {
  const active = useSettingsTab();
  return (
    <>
      <SettingsTabs active={active} />
      <SettingsTabPanel tab="entreprise" active={active}>Profil</SettingsTabPanel>
      <SettingsTabPanel tab="site" active={active}>Aperçu du site</SettingsTabPanel>
    </>
  );
}

afterEach(() => {
  window.location.hash = "";
});

describe("Settings tabs", () => {
  it("opens on the business profile when the address names no tab", () => {
    render(<Harness />);
    expect(screen.getByRole("link", { name: "Entreprise" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Profil")).not.toHaveClass("hidden");
    expect(screen.getByText("Aperçu du site")).toHaveClass("hidden");
  });

  it("follows the address hash, so a link can open a given tab", async () => {
    render(<Harness />);
    await act(async () => {
      window.location.hash = "#site";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("link", { name: "Site et ventes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Aperçu du site")).not.toHaveClass("hidden");
    expect(screen.getByText("Profil")).toHaveClass("hidden");
  });

  it("ignores an unknown hash", async () => {
    render(<Harness />);
    await act(async () => {
      window.location.hash = "#nimportequoi";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("link", { name: "Entreprise" })).toHaveAttribute("aria-current", "page");
  });
});
