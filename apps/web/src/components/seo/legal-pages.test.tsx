import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KORVA_SUPPORT } from "@korva/types";
import { LEGAL_PAGES, LEGAL_PATHS, LEGAL_TITLES } from "@/lib/legal-paths";
import { LegalPageView } from "./legal-pages";
import { PublicFooter } from "./trade-page";

describe("LegalPageView", () => {
  it("names the company exactly as its registration papers do", () => {
    render(<LegalPageView page="notice" locale="fr" />);
    expect(screen.getByRole("heading", { level: 1, name: "Mentions légales" })).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).toContain("VIT GLOBAL TECHNOLOGIES GROUP SARLAU");
    expect(text).toContain("RC 742851, Tribunal de commerce de Casablanca");
    expect(text).toContain("004013219000041");
    // IF and TP as on the DGI identification bulletin of 2026-08-06.
    expect(text).toContain("73292932");
    expect(text).toContain("33304467");
    expect(text).toContain("20 000 MAD");
    expect(text).toContain(KORVA_SUPPORT.email);
  });

  it("states the cancellation rule the code applies (end of the paid period, no pro rata)", () => {
    render(<LegalPageView page="refunds" locale="fr" />);
    expect(screen.getByText(/prend effet à la fin de la période déjà payée/)).toBeInTheDocument();
    expect(screen.getByText(/pas de remboursement au prorata/)).toBeInTheDocument();
  });

  it.each(LEGAL_PAGES)("renders %s in both languages", (page) => {
    for (const locale of ["fr", "en"] as const) {
      const { unmount } = render(<LegalPageView page={page} locale={locale} />);
      expect(screen.getByRole("heading", { level: 1, name: LEGAL_TITLES[page][locale] })).toBeInTheDocument();
      unmount();
    }
  });
});

describe("PublicFooter", () => {
  it("links every legal page, so a payment provider's review finds them from any page", () => {
    render(<PublicFooter locale="en" />);
    for (const page of LEGAL_PAGES) {
      expect(screen.getByRole("link", { name: LEGAL_TITLES[page].en })).toHaveAttribute("href", LEGAL_PATHS[page].en);
    }
  });
});
