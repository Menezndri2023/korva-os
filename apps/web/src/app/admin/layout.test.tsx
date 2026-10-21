import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import AdminLayout from "./layout";
import { renderWithProviders } from "@/test/render";
import { ApiError, apiClient } from "@/lib/api-client";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ bootstrapped: true, accessToken: "token" }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});

const getMock = vi.mocked(apiClient.get);

describe("AdminLayout", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("shows the administration to a platform administrator", async () => {
    getMock.mockResolvedValue({ email: "ops@korva.test" });
    renderWithProviders(<AdminLayout><p>Contenu</p></AdminLayout>);
    expect(await screen.findByText("Contenu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vue d'ensemble" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Commerces" })).toHaveAttribute("href", "/admin/commerces");
    expect(getMock).toHaveBeenCalledWith("/platform/me", { withOrganization: false });
  });

  it("explains a refusal and never renders the pages", async () => {
    getMock.mockImplementation(() => Promise.reject(new ApiError("PLATFORM_ADMIN_ONLY", "Reserved")));
    renderWithProviders(<AdminLayout><p>Contenu</p></AdminLayout>);
    expect(await screen.findByText("Réservé à l'équipe KORVA")).toBeInTheDocument();
    expect(screen.queryByText("Contenu")).toBeNull();
  });
});
