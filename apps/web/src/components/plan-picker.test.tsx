import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Plan, PlanInterval } from "@korva/types";
import { PlanPicker } from "./plan-picker";

function plan(id: string, key: string, priceAmount: number, interval: PlanInterval): Plan {
  return {
    id,
    key,
    name: key[0]!.toUpperCase() + key.slice(1),
    priceAmount,
    priceCurrency: "XOF",
    interval,
    modules: [],
    limits: {},
    createdAt: "",
    updatedAt: "",
  };
}

const PLANS = [
  plan("free", "free", 0, "month"),
  plan("starter-m", "starter", 9900, "month"),
  plan("starter-6", "starter", 53460, "half_year"),
  plan("starter-y", "starter", 99000, "year"),
];

describe("PlanPicker", () => {
  it("sends the chosen duration with the plan, and shows what a year saves", async () => {
    const onChoose = vi.fn();
    render(<PlanPicker plans={PLANS} currentPlanId="free" onChoose={onChoose} pending={false} locale="fr" />);

    await userEvent.click(screen.getByRole("radio", { name: /1 an/ }));
    expect(screen.getByText(/Vous économisez/).textContent).toMatch(/19\s800/);
    // Free stays offered whatever the duration, as the current plan.
    expect(screen.getByRole("button", { name: "Plan actuel" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Choisir" }));
    expect(onChoose).toHaveBeenCalledWith("starter", "year");
  });

  it("opens on the duration of the plan already paid", () => {
    render(<PlanPicker plans={PLANS} currentPlanId="starter-6" onChoose={vi.fn()} pending={false} locale="fr" />);
    expect(screen.getByRole("radio", { name: /6 mois/ })).toHaveAttribute("aria-checked", "true");
  });
});
