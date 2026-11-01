import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import DashboardLayout from "./layout";
import { renderWithProviders } from "@/test/render";
import { ApiError, apiClient } from "@/lib/api-client";

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

let viewOnly: { expiresAt: string } | null = null;
vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      accessToken: "token",
      activeOrganizationId: "org-1",
      bootstrapped: true,
      user: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      clear: vi.fn(),
      setActiveOrganization: vi.fn(),
      viewOnly,
    }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

const getMock = vi.mocked(apiClient.get);

let enabledModules: string[] = [];
let businessModel: string | undefined;
let extraTools: string[] | undefined;
let organizationError: unknown = null;
vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () =>
    organizationError
      ? { data: undefined, error: organizationError }
      : { data: { name: "Org de test", enabledModules, businessModel, extraTools }, error: null },
}));

const orgA = { id: "org-1", name: "Org A" };
const orgB = { id: "org-2", name: "Org B" };

describe("DashboardLayout", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue([]);
    document.body.style.overflow = "";
    businessModel = undefined;
    extraTools = undefined;
    viewOnly = null;
  });

  function navHrefs() {
    return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
  }

  it("shows the kitchen screen only to a restaurant, and training only to a training business", () => {
    // Both used to follow a module alone: every shop saw "Cuisine", every salon "Formations".
    enabledModules = ["commerce", "booking"];

    businessModel = "retail";
    const { unmount } = renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(navHrefs()).not.toContain("/dashboard/kitchen");
    expect(navHrefs()).not.toContain("/dashboard/formation/courses");
    unmount();

    businessModel = "restaurant";
    const restaurant = renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(navHrefs()).toContain("/dashboard/kitchen");
    restaurant.unmount();

    businessModel = "training";
    renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(navHrefs()).toContain("/dashboard/formation/courses");
    expect(navHrefs()).not.toContain("/dashboard/kitchen");
  });

  it("shows the days left of a running trial, with a way to choose a plan", async () => {
    const endsAt = new Date(Date.now() + 3 * 86_400_000 - 60_000).toISOString();
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/subscriptions/me"
          ? { plan: { key: "pro" }, subscription: { trialEndsAt: endsAt } }
          : [],
      ),
    );
    renderWithProviders(<DashboardLayout><div /></DashboardLayout>);

    expect(await screen.findByText(/Essai Pro offert : 3 jours restants/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "choisissez une formule" })).toHaveAttribute(
      "href",
      "/dashboard/settings#abonnement",
    );
  });

  it("warns the owner when the public site is switched off, and only then", () => {
    enabledModules = ["crm", "catalog"];
    const { unmount } = renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(screen.getByText(/Votre site public n'est pas en ligne/)).toBeInTheDocument();
    unmount();

    enabledModules = ["crm", "catalog", "website"];
    renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(screen.queryByText(/Votre site public n'est pas en ligne/)).not.toBeInTheDocument();
  });

  it("shows each trade only its own tools, in its own words", () => {
    enabledModules = ["commerce", "booking", "catalog", "crm"];
    businessModel = "appointments";
    const salon = renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(navHrefs()).toContain("/dashboard/bookings");
    expect(navHrefs()).not.toContain("/dashboard/orders");
    expect(navHrefs()).not.toContain("/dashboard/returns");
    expect(screen.getByRole("link", { name: "Rendez-vous" })).toHaveAttribute("href", "/dashboard/bookings");
    expect(screen.getByRole("link", { name: "Prestations" })).toHaveAttribute("href", "/dashboard/catalog");
    salon.unmount();

    businessModel = "retail";
    renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(navHrefs()).toContain("/dashboard/orders");
    expect(navHrefs()).toContain("/dashboard/returns");
    expect(navHrefs()).not.toContain("/dashboard/bookings");
    expect(screen.getByRole("link", { name: "Produits" })).toBeInTheDocument();
  });

  it("says plainly when the administration is looking, read-only, and until when", () => {
    viewOnly = { expiresAt: "2026-11-01T15:00:00.000Z" };
    renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(screen.getByText(/Vue de l'administration KORVA, en lecture seule/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fermer la vue" })).toBeInTheDocument();
  });

  it("brings back a tool the owner re-enabled from Autres outils", () => {
    enabledModules = ["commerce", "booking"];
    businessModel = "appointments";
    extraTools = ["orders"];
    renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(navHrefs()).toContain("/dashboard/orders");
    expect(navHrefs()).not.toContain("/dashboard/returns");
  });

  it("keeps both screens for an organization with no type of activity, as before", () => {
    enabledModules = ["commerce", "booking"];
    renderWithProviders(<DashboardLayout><div /></DashboardLayout>);
    expect(navHrefs()).toContain("/dashboard/kitchen");
    expect(navHrefs()).toContain("/dashboard/formation/courses");
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

  it("explains a suspension by KORVA instead of showing the dashboard", async () => {
    organizationError = new ApiError("ORGANIZATION_SUSPENDED", "suspended");
    try {
      renderWithProviders(<DashboardLayout><p>Contenu du tableau de bord</p></DashboardLayout>);
      expect(await screen.findByRole("heading", { name: "Compte suspendu" })).toBeInTheDocument();
      expect(screen.queryByText("Contenu du tableau de bord")).toBeNull();
      expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
    } finally {
      organizationError = null;
    }
  });
});
