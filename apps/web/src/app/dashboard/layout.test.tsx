import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import DashboardLayout from "./layout";
import { renderWithProviders } from "@/test/render";

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
      clear: vi.fn(),
    }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

let enabledModules: string[] = [];
vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () => ({ data: { name: "Org de test", enabledModules } }),
}));

describe("DashboardLayout — Analytics module navigation", () => {
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
});
