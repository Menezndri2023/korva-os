import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import VerifyEmailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

const searchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn() } };
});

const postMock = vi.mocked(apiClient.post);

function setToken(token: string | null) {
  searchParamsMock.mockReturnValue(new URLSearchParams(token ? { token } : {}));
}

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    postMock.mockReset();
    setToken("good-token");
  });

  it("shows an invalid-link state and makes no API call when the token is absent", () => {
    setToken(null);
    renderWithProviders(<VerifyEmailPage />);

    expect(screen.getByText(/lien invalide/i)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("submits the token from the URL on mount, exactly once", async () => {
    postMock.mockResolvedValue({ success: true });
    renderWithProviders(<VerifyEmailPage />);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/auth/verify-email",
        { token: "good-token" },
        { withOrganization: false },
      ),
    );
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("shows a pending state while the request is in flight", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<VerifyEmailPage />);

    expect(await screen.findByText(/vérification en cours/i)).toBeInTheDocument();
  });

  it("shows a success state after a successful verification", async () => {
    postMock.mockResolvedValue({ success: true });
    renderWithProviders(<VerifyEmailPage />);

    expect(await screen.findByText(/email vérifié/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/login");
  });

  it("shows a generic French message for INVALID_VERIFICATION_TOKEN, never the raw backend text", async () => {
    postMock.mockRejectedValue(
      new ApiError("INVALID_VERIFICATION_TOKEN", "This verification link is invalid or has expired"),
    );
    renderWithProviders(<VerifyEmailPage />);

    expect(
      await screen.findByText(/ce lien de vérification est invalide ou a expiré/i),
    ).toBeInTheDocument();
  });

  it("shows a generic fallback message for any other error", async () => {
    postMock.mockRejectedValue(new ApiError("SOME_OTHER_ERROR", "boom"));
    renderWithProviders(<VerifyEmailPage />);

    expect(await screen.findByText(/une erreur est survenue/i)).toBeInTheDocument();
  });
});
