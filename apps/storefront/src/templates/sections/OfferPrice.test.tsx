import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfferPrice } from "./OfferPrice";

const pricing = { amount: 40, currency: "EUR" };

/** Intl puts a narrow no-break space before "€"; compare on plain spaces. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/\s/g, " ");

describe("OfferPrice", () => {
  it("shows the price alone when there is no promotion", () => {
    const { container } = render(<OfferPrice offer={{ pricing }} />);
    expect(plain(container.textContent)).toBe("40,00 €");
    expect(container.querySelector("s")).toBeNull();
  });

  it("strikes through the price before promotion and announces it to screen readers", () => {
    const { container } = render(<OfferPrice offer={{ pricing, compareAtPrice: 55 }} />);
    expect(plain(container.querySelector("s")?.textContent)).toBe("55,00 €");
    expect(screen.getByText(/Prix avant promotion : 55,00\s€/)).toHaveClass("sr-only");
    expect(plain(container.textContent)).toContain("40,00 €");
  });

  it("presents a donation's price as the minimum the customer starts from", () => {
    const { container } = render(<OfferPrice offer={{ pricing, freeAmount: true }} />);
    expect(plain(container.textContent)).toBe("À partir de 40,00 €");
  });
});
