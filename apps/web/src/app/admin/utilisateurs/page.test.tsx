import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AdminUsersPage from "./page";
import { renderWithProviders } from "@/test/render";
import { ApiError, apiClient } from "@/lib/api-client";
import type { PlatformUserRow } from "@/lib/platform-admin";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const user: PlatformUserRow = {
  id: "user-1",
  email: "awa@korva.test",
  name: "Awa K",
  createdAt: "2026-10-01T00:00:00Z",
  emailVerified: true,
  twoFactor: false,
  disabledAt: null,
  lastActivityAt: null,
  organizations: [{ id: "org-1", name: "Salon Awa", status: "active" }],
};

describe("AdminUsersPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue([user]);
    postMock.mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("lists every account with its businesses", async () => {
    renderWithProviders(<AdminUsersPage />);
    expect(await screen.findByText("Awa K")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Salon Awa" })).toHaveAttribute("href", "/admin/entreprises/org-1");
  });

  it("disables an account after confirmation", async () => {
    renderWithProviders(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Désactiver" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/users/user-1/disable", undefined, { withOrganization: false }),
    );
  });

  it("sends a password reset email and says so", async () => {
    renderWithProviders(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Réinitialiser le mot de passe" }));
    expect(await screen.findByText("E-mail de réinitialisation envoyé.")).toBeInTheDocument();
  });

  it("explains that one's own account cannot be disabled", async () => {
    postMock.mockRejectedValue(new ApiError("CANNOT_DISABLE_SELF", "no"));
    renderWithProviders(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Désactiver" }));
    expect(await screen.findByText("Vous ne pouvez pas désactiver votre propre compte.")).toBeInTheDocument();
  });
});
