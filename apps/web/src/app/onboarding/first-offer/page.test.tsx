import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { Organization } from "@korva/types";
import FirstOfferPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

const organization = {
  id: "org-1",
  name: "Salon Awa",
  slug: "salon-awa",
  type: "beauté",
  businessModel: "appointments",
  currency: "XOF",
} as Organization;

vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () => ({ data: organization }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn(), patch: vi.fn() } };
});

const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);

describe("FirstOfferPage", () => {
  beforeEach(() => {
    postMock.mockReset();
    patchMock.mockReset();
    postMock.mockResolvedValue({ id: "offer-1" });
    patchMock.mockResolvedValue(organization);
  });

  it("suggests the trade's usual offers and fills the name in one tap", () => {
    renderWithProviders(<FirstOfferPage />);
    fireEvent.click(screen.getByRole("button", { name: "Coupe femme" }));
    expect(screen.getByLabelText("Que proposez-vous ?")).toHaveValue("Coupe femme");
  });

  it("puts the offer online in the organization's currency, with the suggestion's type", async () => {
    renderWithProviders(<FirstOfferPage />);
    fireEvent.click(screen.getByRole("button", { name: "Coupe femme" }));
    fireEvent.change(screen.getByLabelText("Prix (XOF)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Mettre en ligne" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/offers", {
        type: "booking",
        name: "Coupe femme",
        pricing: { amount: 5000, currency: "XOF" },
        images: [],
        status: "active",
      }),
    );
    expect(patchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Votre site est en ligne" })).toBeInTheDocument();
    expect(screen.getByText(/\/salon-awa$/)).toBeInTheDocument();
  });

  it("saves the WhatsApp number when one is given", async () => {
    renderWithProviders(<FirstOfferPage />);
    fireEvent.change(screen.getByLabelText("Que proposez-vous ?"), { target: { value: "Brushing" } });
    fireEvent.change(screen.getByLabelText("Prix (XOF)"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Votre numéro WhatsApp (optionnel)"), {
      target: { value: "+225 07 07 07 07 07" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mettre en ligne" }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", { whatsappNumber: "+225 07 07 07 07 07" }),
    );
  });

  it("explains a WhatsApp number without its country code instead of sending it", async () => {
    renderWithProviders(<FirstOfferPage />);
    fireEvent.change(screen.getByLabelText("Que proposez-vous ?"), { target: { value: "Brushing" } });
    fireEvent.change(screen.getByLabelText("Prix (XOF)"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Votre numéro WhatsApp (optionnel)"), {
      target: { value: "07 07 07 07 07" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mettre en ligne" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Format international attendu");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("asks for a name and a price before sending anything", async () => {
    renderWithProviders(<FirstOfferPage />);
    fireEvent.click(screen.getByRole("button", { name: "Mettre en ligne" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Donnez un nom à votre offre.");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("can always be skipped", () => {
    renderWithProviders(<FirstOfferPage />);
    expect(screen.getByRole("link", { name: "Plus tard, aller au tableau de bord" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
