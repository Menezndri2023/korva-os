import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PublicOrganization } from "@/lib/public-types";
import { telLink, whatsappLink } from "@/lib/contact";
import { WhatsAppButton } from "./WhatsAppButton";
import { SiteFooter } from "./SiteFooter";

describe("whatsappLink", () => {
  it("keeps only the digits, as wa.me expects", () => {
    expect(whatsappLink("+225 07 07 07 07 07")).toBe("https://wa.me/2250707070707");
  });

  it("carries the first message, encoded", () => {
    expect(whatsappLink("+33 6 12 34 56 78", "Bonjour, « Savon » ?")).toBe(
      "https://wa.me/33612345678?text=Bonjour%2C%20%C2%AB%20Savon%20%C2%BB%20%3F",
    );
  });
});

describe("telLink", () => {
  it("drops spaces but keeps the plus", () => {
    expect(telLink("+225 27 22 00 00 00")).toBe("tel:+2252722000000");
  });
});

describe("WhatsAppButton", () => {
  it("opens a conversation with the shop, greeting already typed", () => {
    render(<WhatsAppButton number="+225 07 07 07 07 07" shopName="Freeworld" />);
    const link = screen.getByRole("link", { name: "Écrire à Freeworld sur WhatsApp" });
    expect(link).toHaveAttribute("href", "https://wa.me/2250707070707?text=Bonjour%20Freeworld%2C%20");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("SiteFooter contact details", () => {
  const base = { name: "Freeworld", slug: "freeworld" } as PublicOrganization;

  it("shows only what the shop gave", () => {
    render(
      <SiteFooter
        organization={{ ...base, contactPhone: "27 22 00 00 00", contactAddress: "Cocody, Abidjan" }}
        links={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "27 22 00 00 00" })).toHaveAttribute("href", "tel:2722000000");
    expect(screen.getByText("Cocody, Abidjan")).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
  });

  it("renders no contact list at all without any detail", () => {
    render(<SiteFooter organization={base} links={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
