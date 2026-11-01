import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Organization } from "@korva/types";
import { OtherToolsSettings } from "./other-tools-settings";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, patch: vi.fn() } };
});
const patchMock = vi.mocked(apiClient.patch);

describe("OtherToolsSettings", () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockResolvedValue({});
  });

  it("offers a salon only the tools its trade does not use, and saves the one switched on", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OtherToolsSettings organization={{ id: "o", businessModel: "appointments" } as Organization} />,
    );
    expect(screen.getByRole("switch", { name: /Commandes/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: /Retours/ })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Réservations/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /Commandes/ }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", { extraTools: ["orders"] }),
    );
  });

  it("removes a tool switched off", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OtherToolsSettings
        organization={{ id: "o", businessModel: "appointments", extraTools: ["orders", "returns"] } as Organization}
      />,
    );
    await user.click(screen.getByRole("switch", { name: /Retours/ }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", { extraTools: ["orders"] }),
    );
  });

  it("shows nothing to an organization with no type of activity", () => {
    const { container } = renderWithProviders(
      <OtherToolsSettings organization={{ id: "o" } as Organization} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
