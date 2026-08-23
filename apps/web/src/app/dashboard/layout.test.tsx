import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import DashboardLayout from "./layout";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/dashboard",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
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
    document.body.style.overflow = "";
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

  describe("mobile drawer — ARIA, scroll-lock, Escape", () => {
    beforeEach(() => {
      enabledModules = ["crm"];
    });

    it("A — closed by default: aria-expanded=false, aria-controls matches the aside's id", () => {
      renderWithProviders(
        <DashboardLayout>
          <div />
        </DashboardLayout>,
      );
      const hamburger = screen.getByRole("button", { name: "Ouvrir le menu" });
      expect(hamburger).toHaveAttribute("aria-expanded", "false");
      expect(hamburger).toHaveAttribute("aria-controls", "mobile-sidebar");
      expect(document.getElementById("mobile-sidebar")).toBeInTheDocument();
    });

    it("B — opening via the hamburger sets aria-expanded=true and locks body scroll", () => {
      renderWithProviders(
        <DashboardLayout>
          <div />
        </DashboardLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
      expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(document.body.style.overflow).toBe("hidden");
    });

    it("C — closing via the backdrop restores aria-expanded and body scroll", () => {
      renderWithProviders(
        <DashboardLayout>
          <div />
        </DashboardLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
      fireEvent.click(screen.getByRole("button", { name: "Fermer le menu" }));
      expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(document.body.style.overflow).toBe("");
    });

    it("D — Escape closes the drawer and restores body scroll", () => {
      renderWithProviders(
        <DashboardLayout>
          <div />
        </DashboardLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(document.body.style.overflow).toBe("");
    });

    it("E — restores a pre-existing body overflow value instead of blindly resetting to empty", () => {
      // Simulates some unrelated part of the app already having set an overflow value before
      // the drawer ever opens — the lock must not clobber it.
      document.body.style.overflow = "scroll";
      renderWithProviders(
        <DashboardLayout>
          <div />
        </DashboardLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(screen.getByRole("button", { name: "Fermer le menu" }));

      expect(document.body.style.overflow).toBe("scroll");
    });

    it("cleanup — unmounting while the drawer is open still restores the original body scroll", () => {
      const { unmount } = renderWithProviders(
        <DashboardLayout>
          <div />
        </DashboardLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
      expect(document.body.style.overflow).toBe("hidden");

      unmount();

      expect(document.body.style.overflow).toBe("");
    });

    it("F — clicking a nav link closes the drawer", () => {
      renderWithProviders(
        <DashboardLayout>
          <div />
        </DashboardLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
      expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      fireEvent.click(screen.getByRole("link", { name: "CRM" }));

      expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });
});
