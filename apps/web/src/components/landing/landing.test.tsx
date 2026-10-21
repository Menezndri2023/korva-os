import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PLAN_NAMES,
  SIGNUP_TRIAL,
  STOREFRONT_PALETTES,
  VERTICAL_TEMPLATES,
  getStorefrontTemplate,
} from "@korva/types";
import { SitePreview } from "./site-preview";
import { TradePanel } from "./trade-panel";
import { PlanLadder } from "./plan-ladder";

const restaurant = VERTICAL_TEMPLATES.find((v) => v.businessModel === "restaurant")!;

describe("SitePreview", () => {
  it("draws the trade's site in its template's first palette", () => {
    const { container } = render(<SitePreview vertical={restaurant} />);
    const template = getStorefrontTemplate(restaurant.defaultStorefrontTemplate);
    const palette = STOREFRONT_PALETTES[template.palettes[0]!];
    const phone = container.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(phone.style.getPropertyValue("--p-accent")).toBe(palette.accent);
    expect(screen.getByText(`Votre site, modèle « ${template.label} »`)).toBeInTheDocument();
  });

  it("lists the offers the catalogue suggests for the trade", () => {
    render(<SitePreview vertical={restaurant} />);
    for (const offer of restaurant.suggestedOffers!.slice(0, 4)) {
      expect(screen.getByText(offer.name)).toBeInTheDocument();
    }
  });
});

describe("TradePanel", () => {
  it("redraws the phone when the visitor picks another trade", async () => {
    render(<TradePanel />);
    await userEvent.click(screen.getByRole("radio", { name: restaurant.label }));
    const template = getStorefrontTemplate(restaurant.defaultStorefrontTemplate);
    expect(screen.getByText(`Votre site, modèle « ${template.label} »`)).toBeInTheDocument();
  });
});

describe("PlanLadder", () => {
  it("opens on the trial plan on a phone, flagged as offered", () => {
    render(<PlanLadder />);
    const switcher = screen.getByRole("group", { name: "Formule affichée" });
    expect(
      within(switcher).getByRole("button", { name: PLAN_NAMES[SIGNUP_TRIAL.plan] }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(`${SIGNUP_TRIAL.days} jours offerts`)).toBeInTheDocument();
  });

  it("switches the plan shown on a phone", async () => {
    render(<PlanLadder />);
    const switcher = screen.getByRole("group", { name: "Formule affichée" });
    await userEvent.click(within(switcher).getByRole("button", { name: PLAN_NAMES.free }));
    expect(within(switcher).getByRole("button", { name: PLAN_NAMES.free })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const freeHeading = screen.getByRole("heading", { level: 3, name: PLAN_NAMES.free });
    expect(freeHeading.closest("div.py-6")).toHaveClass("grid");
  });
});
