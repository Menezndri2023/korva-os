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
  it("shows the four plans as cards, the trial plan flagged as offered", () => {
    render(<PlanLadder />);
    for (const name of Object.values(PLAN_NAMES)) {
      expect(screen.getByRole("heading", { level: 3, name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    const trial = screen.getByRole("heading", { level: 3, name: new RegExp(`^${PLAN_NAMES[SIGNUP_TRIAL.plan]}`) }).closest("article")!;
    expect(within(trial).getByText(`${SIGNUP_TRIAL.days} jours offerts`)).toBeInTheDocument();
    expect(within(trial).getByRole("link", { name: "Essayer 14 jours" })).toHaveAttribute("href", "/register");
  });

  it("keeps the full list of each plan one tap away", async () => {
    render(<PlanLadder />);
    const free = screen.getByRole("heading", { level: 3, name: new RegExp(`^${PLAN_NAMES.free}`) }).closest("article")!;
    const more = within(free).getByText(/Tout le détail \(\d+ de plus\)/);
    await userEvent.click(more);
    expect(within(free).getByText("Replier le détail")).toBeInTheDocument();
  });
});

describe("TradePanel — other trades", () => {
  it("reaches a trade that is not among the chips through the list", async () => {
    render(<TradePanel />);
    const last = VERTICAL_TEMPLATES[VERTICAL_TEMPLATES.length - 1]!;
    await userEvent.selectOptions(screen.getAllByRole("combobox", { name: "Autre métier…" })[0]!, last.key);
    expect(screen.getAllByText(last.label).length).toBeGreaterThan(0);
  });
});
