import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import AdminLayout from "./layout";
import { renderWithProviders } from "@/test/render";
import { ApiError } from "@/lib/api-client";

const replace = vi.fn();
let pathname = "/admin";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

let token: string | null = "admin-token";
let me: { data?: { email: string }; isError: boolean; error?: unknown } = { isError: false };
vi.mock("@/lib/platform-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-admin")>();
  return {
    ...actual,
    useAdminToken: () => token,
    usePlatformAdmin: () => me,
    setAdminToken: vi.fn(),
  };
});

describe("AdminLayout", () => {
  beforeEach(() => {
    replace.mockReset();
    pathname = "/admin";
    token = "admin-token";
    me = { data: { email: "ops@korva.test" }, isError: false };
  });

  it("shows the administration to a signed-in administrator", () => {
    renderWithProviders(<AdminLayout><p>Contenu</p></AdminLayout>);
    expect(screen.getByText("Contenu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vue d'ensemble" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Entreprises" })).toHaveAttribute("href", "/admin/entreprises");
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
  });

  it("sends anyone without an administrator session to the administration's own sign-in", () => {
    token = null;
    me = { isError: false };
    renderWithProviders(<AdminLayout><p>Contenu</p></AdminLayout>);
    expect(replace).toHaveBeenCalledWith("/admin/connexion");
    expect(screen.queryByText("Contenu")).toBeNull();
  });

  it("renders the sign-in page bare, without the administration around it", () => {
    pathname = "/admin/connexion";
    token = null;
    renderWithProviders(<AdminLayout><p>Formulaire</p></AdminLayout>);
    expect(screen.getByText("Formulaire")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Entreprises" })).toBeNull();
  });

  it("asks to sign in again when the session was refused", () => {
    me = { isError: true, error: new ApiError("PLATFORM_ADMIN_ONLY", "no") };
    renderWithProviders(<AdminLayout><p>Contenu</p></AdminLayout>);
    expect(screen.getByText("Session expirée")).toBeInTheDocument();
    expect(screen.queryByText("Contenu")).toBeNull();
  });
});
