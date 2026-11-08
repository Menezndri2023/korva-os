import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PublicOrganization } from "@/lib/public-types";
import { siteSubtitle } from "@/lib/site-subtitle";
import { PracticalInfo } from "./PracticalInfo";

function organization(overrides: Partial<PublicOrganization> = {}) {
  return { name: "Chez Awa", slug: "chez-awa", acceptedPaymentMethods: [], ...overrides } as PublicOrganization;
}

const fr = (french: string) => french;

describe("PracticalInfo", () => {
  it("says only what the business chose: cash only, delivery, WhatsApp", () => {
    render(
      <PracticalInfo
        organization={organization({
          acceptedPaymentMethods: ["cash"],
          fulfillmentModes: ["delivery", "pickup"],
          whatsappNumber: "+225 07 07 07 07 07",
        })}
        commerceEnabled
        bookingEnabled={false}
      />,
    );
    expect(screen.getByText("espèces")).toBeInTheDocument();
    expect(screen.queryByText(/Wave/)).not.toBeInTheDocument();
    expect(screen.getByText("livraison, retrait sur place")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp +225 07 07 07 07 07")).toBeInTheDocument();
    expect(screen.queryByText("Réservation")).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing true to say", () => {
    const { container } = render(
      <PracticalInfo organization={organization()} commerceEnabled={false} bookingEnabled={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("siteSubtitle", () => {
  it("prefers the business's own tagline", () => {
    expect(siteSubtitle(organization({ tagline: "Le meilleur garba" }), fr)).toBe("Le meilleur garba");
  });

  it("falls back to a line that matches the trade", () => {
    expect(siteSubtitle(organization({ businessModel: "appointments" } as Partial<PublicOrganization>), fr)).toBe(
      "Prenez rendez-vous en ligne, en quelques secondes.",
    );
  });
});
