import { describe, expect, it } from "vitest";
import { planLimitMessage } from "./api-client";

describe("planLimitMessage", () => {
  it("names the limit and the way out for a counted quota", () => {
    expect(planLimitMessage("PLAN_LIMIT_REACHED", { metric: "offers", limit: 30 })).toBe(
      "Votre formule permet 30 offres au catalogue. Passez à la formule supérieure pour en ajouter.",
    );
  });

  it("shows the extra-user price and says it is coming while it cannot be bought", () => {
    const message = planLimitMessage("SEAT_LIMIT_REACHED", {
      limit: 1,
      extraSeat: { price: 1500, currency: "XOF", purchasable: false },
    });
    expect(message).toContain("1 utilisateur du tableau de bord");
    expect(message).toContain("1500 XOF/mois");
    expect(message).toContain("arrive bientôt");
    expect(message).toContain("n'ont pas besoin de compte");
  });

  it("leaves every other error to the API's own message", () => {
    expect(planLimitMessage("OFFER_IN_USE", {})).toBeUndefined();
  });
});
