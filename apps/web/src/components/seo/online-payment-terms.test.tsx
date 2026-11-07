import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnlinePaymentTerms } from "./online-payment-terms";

describe("OnlinePaymentTerms", () => {
  it("states the rates KORVA actually applies, and that online payment is optional", () => {
    render(<OnlinePaymentTerms locale="fr" />);
    expect(screen.getByRole("heading", { level: 1, name: "Conditions du paiement en ligne" })).toBeInTheDocument();
    expect(screen.getByText(/Il est facultatif/)).toBeInTheDocument();
    const starter = screen.getByRole("cell", { name: "Starter" }).closest("tr")!;
    expect(starter.textContent).toContain("2 %");
    const business = screen.getByRole("cell", { name: "Business" }).closest("tr")!;
    expect(business.textContent).toContain("1 %");
    expect(screen.getByText(/Wave 2,5 % \+ 100 F/)).toBeInTheDocument();
  });

  it("exists in English too", () => {
    render(<OnlinePaymentTerms locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Online payment terms" })).toBeInTheDocument();
  });
});
