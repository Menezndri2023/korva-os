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
