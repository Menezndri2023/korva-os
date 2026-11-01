import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { SiteHeader, siteLinks } from "./SiteHeader";
import { OfferImage } from "./OfferImage";
import { MobileCartBar } from "./MobileCartBar";

const organization = { name: "Freeworld", slug: "freeworld" } as PublicOrganization;

function renderHeader(overrides: Partial<Parameters<typeof SiteHeader>[0]> = {}) {
  const onOpenCheckout = vi.fn();
  render(
    <SiteHeader
      slug="freeworld"
      organization={organization}
      links={siteLinks("freeworld", true, { catalog: "Catalogue complet", track: "Suivre ma commande" })}
      authHydrated
      isAuthenticated={false}
      commerceEnabled
      cartCount={2}
      onOpenCheckout={onOpenCheckout}
      {...overrides}
    />,
  );
  return { onOpenCheckout };
}

describe("siteLinks", () => {
  it("leaves the catalogue out when the shop hides it", () => {
    expect(siteLinks("s", false, { catalog: "Catalogue", track: "Suivi" })).toEqual([
      { href: "/s/track", label: "Suivi" },
    ]);
  });
});

describe("SiteHeader", () => {
  it("shows the initial when the shop has no logo", () => {
    renderHeader();
    expect(screen.getByText("F")).toBeInTheDocument();
  });

  it("opens the cart from an icon that says how many items it holds", () => {
    const { onOpenCheckout } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Voir le panier, 2 articles" }));
    expect(onOpenCheckout).toHaveBeenCalledOnce();
  });

  it("disables an empty cart", () => {
    renderHeader({ cartCount: 0 });
    expect(screen.getByRole("button", { name: "Panier vide" })).toBeDisabled();
  });

  it("has no cart at all without online selling", () => {
    renderHeader({ commerceEnabled: false });
    expect(screen.queryByRole("button", { name: /panier/i })).toBeNull();
  });

  it("offers no sign-in where no account can exist (Free plan, none created before)", () => {
    renderHeader({ organization: { ...organization, customerSignInAvailable: false } });
    expect(screen.queryByRole("link", { name: /Se connecter/ })).not.toBeInTheDocument();
  });

  it("still shows a signed-in customer their account on such a site", () => {
    renderHeader({
      organization: { ...organization, customerSignInAvailable: false },
      isAuthenticated: true,
      customerFirstName: "Awa",
    });
    expect(screen.getAllByRole("link", { name: /Awa/ }).length).toBeGreaterThan(0);
  });

  it("offers every link in the phone menu too, with the account last", () => {
    renderHeader();
    // Desktop nav + mobile menu: each link is rendered in both.
    expect(screen.getAllByRole("link", { name: "Suivre ma commande" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Se connecter/ })[1]).toHaveAttribute(
      "href",
      "/freeworld/account/login",
    );
  });
});

const offer = { id: "o1", name: "Savon noir", images: [] } as unknown as PublicOffer;

describe("OfferImage", () => {
  it("falls back to the offer's initial instead of 'no image'", () => {
    render(<OfferImage offer={offer} />);
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("renders nothing without a photo when asked to", () => {
    const { container } = render(<OfferImage offer={offer} fallback="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("loads the photo lazily unless it is part of the first screen", () => {
    const withImage = { ...offer, images: ["https://img.test/a.jpg"] } as PublicOffer;
    const { rerender } = render(<OfferImage offer={withImage} />);
    expect(screen.getByRole("img", { name: "Savon noir" })).toHaveAttribute("loading", "lazy");
    rerender(<OfferImage offer={withImage} priority />);
    expect(screen.getByRole("img", { name: "Savon noir" })).toHaveAttribute("loading", "eager");
  });
});

describe("MobileCartBar", () => {
  it("stays hidden while the cart is empty", () => {
    const { container } = render(<MobileCartBar cartCount={0} onOpenCheckout={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leads to the checkout once something is in the cart", () => {
    const onOpenCheckout = vi.fn();
    render(<MobileCartBar cartCount={1} onOpenCheckout={onOpenCheckout} />);
    fireEvent.click(screen.getByRole("button", { name: /1 article/ }));
    expect(onOpenCheckout).toHaveBeenCalledOnce();
  });
});
