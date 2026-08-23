import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import OnboardingPage from "./page";
import { renderWithProviders } from "@/test/render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setActiveOrganization: vi.fn() }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn(), patch: vi.fn() } };
});

describe("OnboardingPage — Analytics not selectable (Lot F1-A)", () => {
  it('does not offer "Statistiques" as an activatable module', () => {
    renderWithProviders(<OnboardingPage />);
    expect(screen.queryByText("Statistiques")).not.toBeInTheDocument();
    // Sanity check: other modules are still offered — only "analytics" was filtered out.
    expect(screen.getByText("Clients & Prospects (CRM)")).toBeInTheDocument();
  });
});
