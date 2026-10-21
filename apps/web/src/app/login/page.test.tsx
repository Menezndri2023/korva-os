import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import LoginPage from "./page";
import { renderWithProviders } from "@/test/render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn(), get: vi.fn() } };
});

// Minimal, Lot U-scoped: only the new "forgot password" link. Not a full audit of the login page.
describe("LoginPage — forgot password link", () => {
  it('links "Mot de passe oublié ?" to /forgot-password', () => {
    renderWithProviders(<LoginPage />);
    const link = screen.getByRole("link", { name: /mot de passe oublié/i });
    expect(link).toHaveAttribute("href", "/forgot-password");
  });
});

describe("LoginPage — refused sign-ins, in French", () => {
  it("says a disabled account must contact KORVA, not that the password is wrong", async () => {
    const { apiClient, ApiError } = await import("@/lib/api-client");
    vi.mocked(apiClient.post).mockRejectedValueOnce(new ApiError("ACCOUNT_DISABLED", "This account has been disabled."));
    const { fireEvent } = await import("@testing-library/react");
    renderWithProviders(<LoginPage />);
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "awa@korva.test" } });
    fireEvent.input(screen.getByLabelText("Mot de passe"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("Ce compte a été désactivé. Contactez le support KORVA.")).toBeInTheDocument();
  });
});
