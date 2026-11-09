import { describe, it, expect } from "vitest";
import type { PublicOrganization } from "./public-types";
import { clipText, shareImage, siteDescription, siteTitle } from "./seo-text";

const fr = (french: string) => french;
const shop = {
  name: "Freeworld",
  businessModel: "retail",
  enabledModules: ["catalog", "commerce"],
} as unknown as PublicOrganization;

describe("seo text for a business's site", () => {
  it("says what the business is after its name, unless it wrote its own title", () => {
    expect(siteTitle(shop, fr)).toBe("Freeworld — Boutique en ligne");
    expect(siteTitle({ ...shop, seoTitle: "Freeworld, objets de luxe" } as PublicOrganization, fr)).toBe(
      "Freeworld, objets de luxe",
    );
    expect(siteTitle({ ...shop, businessModel: undefined } as PublicOrganization, fr)).toBe("Freeworld");
  });

  it("leads with the business's own words and names each offer once", () => {
    const description = siteDescription(
      { ...shop, tagline: "Objets de luxe certifiés" } as PublicOrganization,
      ["Coin", "Coins", "coins", "Pièce"],
      fr,
    );
    expect(description).toBe("Objets de luxe certifiés. Commande en ligne. À découvrir : Coin, Coins, Pièce.");
    expect(description).not.toContain("KORVA");
  });

  it("keeps the business's own description untouched", () => {
    expect(siteDescription({ ...shop, seoDescription: "Ma description." } as PublicOrganization, ["A"], fr)).toBe(
      "Ma description.",
    );
  });

  it("cuts long text at a word, where search results cut it", () => {
    const clipped = clipText(`${"mot ".repeat(60)}fin`);
    expect(clipped.length).toBeLessThanOrEqual(158);
    expect(clipped.endsWith("mot…")).toBe(true);
    expect(clipText("  court  ")).toBe("court");
  });

  it("shares a real photo first, then the logo, never a placeholder", () => {
    expect(shareImage({ ...shop, heroImage: "h.jpg", logo: "l.png" } as PublicOrganization)).toBe("h.jpg");
    expect(shareImage({ ...shop, logo: "l.png" } as PublicOrganization)).toBe("l.png");
    expect(shareImage(shop)).toBeUndefined();
  });
});
