import { describe, it, expect } from "vitest";
import type { PublicOrganization } from "@/lib/public-types";
import { accountLinks } from "./profile-client";

function labels(businessModel: PublicOrganization["businessModel"], enabledModules: string[]) {
  return accountLinks({ businessModel, enabledModules } as PublicOrganization).map((link) => link.label);
}

describe("accountLinks", () => {
  it("gives each trade its own sections, in its own words", () => {
    expect(labels("retail", ["catalog", "commerce"])).toEqual(["Mes commandes", "Mes retours", "Mes favoris"]);
    expect(labels("appointments", ["catalog", "booking"])).toEqual(["Mes rendez-vous"]);
    expect(labels("real_estate", ["catalog", "booking"])).toEqual(["Mes visites", "Mes favoris"]);
    expect(labels("training", ["catalog", "booking"])).toEqual(["Mes inscriptions", "Mes formations"]);
    // An association sells memberships: no returns, no wishlist.
    expect(labels("association", ["catalog", "commerce", "booking"])).toEqual(["Mes commandes", "Mes événements"]);
    expect(labels("restaurant", ["catalog", "commerce", "booking"])).toEqual([
      "Mes commandes",
      "Mes réservations de table",
    ]);
  });

  it("lists every section until the business is known", () => {
    expect(accountLinks(undefined).map((link) => link.path)).toEqual([
      "orders",
      "bookings",
      "quotes",
      "returns",
      "wishlist",
      "learning",
    ]);
  });
});
