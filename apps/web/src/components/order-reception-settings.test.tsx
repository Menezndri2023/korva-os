import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Organization } from "@korva/types";
import { OrderReceptionSettings } from "./order-reception-settings";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, patch: vi.fn() } };
});
const patchMock = vi.mocked(apiClient.patch);

const organization = { id: "org-1", currency: "XOF" } as Organization;

describe("OrderReceptionSettings", () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockResolvedValue(organization);
  });

  it("says nothing changes until a mode is saved, and cannot save with no mode", () => {
    renderWithProviders(<OrderReceptionSettings organization={organization} />);
    expect(screen.getByText(/applique le tarif de livraison fixe/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it("saves the modes, the delivery zones and the pickup instructions", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrderReceptionSettings organization={organization} />);

    await user.click(screen.getByRole("checkbox", { name: "Retrait sur place" }));
    await user.click(screen.getByRole("checkbox", { name: "Livraison" }));
    await user.click(screen.getByRole("button", { name: "Ajouter une zone" }));
    await user.type(screen.getByLabelText("Nom de la zone 1"), "Cocody");
    await user.clear(screen.getByLabelText("Frais de la zone 1"));
    await user.type(screen.getByLabelText("Frais de la zone 1"), "1000");
    await user.type(screen.getByLabelText("Minimum de commande de la zone 1"), "5000");
    await user.type(screen.getByLabelText("Instructions de retrait"), "Comptoir à gauche");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/organizations/me",
        expect.objectContaining({
          // Kept in the canonical order whatever the clicking order was.
          fulfillmentModes: ["delivery", "pickup"],
          deliveryZones: [
            expect.objectContaining({ name: "Cocody", fee: 1000, minimumOrder: 5000 }),
          ],
          pickupInstructions: "Comptoir à gauche",
        }),
      ),
    );
  });
});
