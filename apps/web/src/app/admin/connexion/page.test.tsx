import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AdminSignInPage from "./page";
import { renderWithProviders } from "@/test/render";
import { ApiError } from "@/lib/api-client";
import { adminApi, setAdminToken } from "@/lib/platform-admin";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

vi.mock("@/lib/platform-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-admin")>();
  return { ...actual, adminApi: { get: vi.fn(), post: vi.fn(), getList: vi.fn() }, setAdminToken: vi.fn() };
});

const postMock = vi.mocked(adminApi.post);

function fill() {
  fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "ops@korva.test" } });
  fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
}

describe("AdminSignInPage", () => {
  beforeEach(() => {
    postMock.mockReset();
    replace.mockReset();
  });

  it("signs in against the administration's own endpoint and keeps its own session", async () => {
    postMock.mockResolvedValue({ accessToken: "admin-token" });
    renderWithProviders(<AdminSignInPage />);
    fill();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
    expect(postMock).toHaveBeenCalledWith("/platform/auth/login", { email: "ops@korva.test", password: "secret" });
    expect(setAdminToken).toHaveBeenCalledWith("admin-token");
  });

  it("explains a refused sign-in in French", async () => {
    postMock.mockRejectedValue(new ApiError("INVALID_CREDENTIALS", "Invalid"));
    renderWithProviders(<AdminSignInPage />);
    fill();
    expect(await screen.findByRole("alert")).toHaveTextContent("Adresse ou mot de passe incorrect.");
  });

  it("offers no sign-up", () => {
    renderWithProviders(<AdminSignInPage />);
    expect(screen.queryByText(/créer un compte/i)).toBeNull();
  });
});
