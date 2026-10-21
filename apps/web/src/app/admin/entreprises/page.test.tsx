import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import AdminShopsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { adminApi } from "@/lib/platform-admin";

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ bootstrapped: true, accessToken: "token" }),
}));

vi.mock("@/lib/platform-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-admin")>();
  return { ...actual, adminApi: { get: vi.fn(), post: vi.fn(), getList: vi.fn() } };
});

const getMock = vi.mocked(adminApi.get);

const row = (slug: string, issues: string[]) => ({
  id: slug,
  name: slug,
  slug,
  createdAt: "2026-10-01T00:00:00Z",
  ownerEmail: `${slug}@korva.test`,
  activeOffers: issues.includes("site_vide") ? 0 : 3,
  hasLogo: false,
  hasWhatsapp: false,
  websiteEnabled: true,
  lastActivityAt: null,
  nudgedAt: null,
  issues,
});

describe("AdminShopsPage", () => {
  // Braces matter: mockReset() returns the mock, and a function returned from beforeEach is
  // run by Vitest as a cleanup hook — it called the rejecting mock after the test.
  beforeEach(() => {
    getMock.mockReset();
  });

  it("filters the shops by what they need", async () => {
    getMock.mockResolvedValue([row("empty-shop", ["site_vide"]), row("busy-shop", ["sans_logo"])]);
    renderWithProviders(<AdminShopsPage />);
    expect(await screen.findByText("busy-shop")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Site vide (1)" }));
    expect(screen.getByText("empty-shop")).toBeInTheDocument();
    expect(screen.queryByText("busy-shop")).toBeNull();
  });
});
