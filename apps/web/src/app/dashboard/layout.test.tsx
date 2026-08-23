import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import DashboardLayout from "./layout";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/dashboard",
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      accessToken: "token",
      activeOrganizationId: "org-1",
      bootstrapped: true,
      user: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      clear: vi.fn(),
      setActiveOrganization: vi.fn(),
    }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

const getMock = vi.mocked(apiClient.get);

let enabledModules: string[] = [];
vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () => ({ data: { name: "Org de test", enabledModules } }),
}));

const orgA = { id: "org-1", name: "Org A" };
const orgB = { id: "org-2", name: "Org B" };

describe("DashboardLayout", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue([]);
  });

  it("links to /dashboard/analytics once the module is enabled for the organization", () => {
    enabledModules = ["analytics", "crm"];
    renderWithProviders(
      <DashboardLayout>
        <div />
      </DashboardLayout>,
    );
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/dashboard/analytics");
    expect(hrefs).toContain("/dashboard/crm");
  });

  it("never shows a dead /dashboard/analytics link for an organization that hasn't enabled the module", () => {
    enabledModules = ["crm"];
    renderWithProviders(
      <DashboardLayout>
        <div />
      </DashboardLayout>,
    );
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/dashboard/analytics");
    expect(hrefs).toContain("/dashboard/crm");
  });

  it("shows an organization switcher when the user belongs to more than one organization", async () => {
    enabledModules = ["crm"];
    getMock.mockResolvedValue([orgA, orgB]);
    renderWithProviders(
      <DashboardLayout>
        <div />
      </DashboardLayout>,
    );
    await waitFor(() => expect(screen.getByText("Org B")).toBeInTheDocument());
  });

  it("hides the switcher for a user who only belongs to one organization", async () => {
    enabledModules = ["crm"];
    getMock.mockResolvedValue([orgA]);
    renderWithProviders(
      <DashboardLayout>
        <div />
      </DashboardLayout>,
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByText("Org A")).not.toBeInTheDocument();
  });
});
